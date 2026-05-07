// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * KickBaseEscrow — Base Sepolia Testnet
 *
 * Flow:
 *  1. Player A calls createMatch(matchId) with ETH = wager amount
 *  2. Player B calls joinMatch(matchId) with the same ETH amount
 *  3. After game ends, your backend (or Player A) calls settleMatch(matchId, winner)
 *     - winner = 1  → Player A receives full pot
 *     - winner = 2  → Player B receives full pot
 *     - winner = 0  → Draw, both refunded
 *  4. Loser's ETH is deducted; winner receives double the wager
 *
 * Deploy to Base Sepolia:
 *   Network:  Base Sepolia Testnet
 *   RPC:      https://sepolia.base.org
 *   Chain ID: 84532
 *   Explorer: https://sepolia.basescan.org
 *
 * To deploy (Remix IDE or Hardhat):
 *   Constructor arg: _owner = your wallet address (game operator)
 *
 * IMPORTANT: In production, use a trusted oracle or commit-reveal
 * scheme for result submission to prevent cheating.
 */

contract KickBaseEscrow {

    address public owner;
    uint256 public platformFeeBps = 100; // 1% fee (100 basis points)

    enum MatchState { Open, Active, Settled, Cancelled }

    struct Match {
        address playerA;
        address playerB;
        uint256 wager;       // per-player wager in wei
        MatchState state;
        uint8 winner;        // 0=draw, 1=playerA, 2=playerB
    }

    mapping(bytes32 => Match) public matches;
    mapping(address => uint256) public earnings; // withdrawable balances

    event MatchCreated(bytes32 indexed matchId, address indexed playerA, uint256 wager);
    event MatchJoined(bytes32 indexed matchId, address indexed playerB);
    event MatchSettled(bytes32 indexed matchId, uint8 winner, uint256 pot);
    event MatchCancelled(bytes32 indexed matchId);
    event Withdrawn(address indexed player, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier matchExists(bytes32 matchId) {
        require(matches[matchId].playerA != address(0), "Match not found");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    // ─── CREATE MATCH ────────────────────────────────────────────────────────
    // Player A creates a match and locks their wager
    function createMatch(bytes32 matchId) external payable {
        require(msg.value > 0, "Wager must be > 0");
        require(matches[matchId].playerA == address(0), "Match ID already exists");

        matches[matchId] = Match({
            playerA: msg.sender,
            playerB: address(0),
            wager: msg.value,
            state: MatchState.Open,
            winner: 0
        });

        emit MatchCreated(matchId, msg.sender, msg.value);
    }

    // ─── JOIN MATCH ──────────────────────────────────────────────────────────
    // Player B accepts and locks the same wager amount
    function joinMatch(bytes32 matchId) external payable matchExists(matchId) {
        Match storage m = matches[matchId];
        require(m.state == MatchState.Open, "Match not open");
        require(msg.sender != m.playerA, "Cannot play yourself");
        require(msg.value == m.wager, "Must match exact wager");

        m.playerB = msg.sender;
        m.state = MatchState.Active;

        emit MatchJoined(matchId, msg.sender);
    }

    // ─── SETTLE MATCH ────────────────────────────────────────────────────────
    // Only owner (game server) can settle after match ends
    // winner: 1 = playerA wins, 2 = playerB wins, 0 = draw
    function settleMatch(bytes32 matchId, uint8 winner) external onlyOwner matchExists(matchId) {
        Match storage m = matches[matchId];
        require(m.state == MatchState.Active, "Match not active");
        require(winner <= 2, "Invalid winner value");

        m.state = MatchState.Settled;
        m.winner = winner;

        uint256 pot = m.wager * 2;
        uint256 fee = (pot * platformFeeBps) / 10000;
        uint256 payout = pot - fee;

        earnings[owner] += fee; // Platform fee

        if (winner == 1) {
            earnings[m.playerA] += payout;
        } else if (winner == 2) {
            earnings[m.playerB] += payout;
        } else {
            // Draw — refund both (split fee from pot)
            earnings[m.playerA] += m.wager - fee / 2;
            earnings[m.playerB] += m.wager - fee / 2;
        }

        emit MatchSettled(matchId, winner, pot);
    }

    // ─── CANCEL MATCH ────────────────────────────────────────────────────────
    // Player A can cancel if no one has joined yet
    function cancelMatch(bytes32 matchId) external matchExists(matchId) {
        Match storage m = matches[matchId];
        require(m.state == MatchState.Open, "Can only cancel open matches");
        require(msg.sender == m.playerA || msg.sender == owner, "Not authorized");

        m.state = MatchState.Cancelled;
        earnings[m.playerA] += m.wager;

        emit MatchCancelled(matchId);
    }

    // ─── WITHDRAW ────────────────────────────────────────────────────────────
    // Players pull their winnings
    function withdraw() external {
        uint256 amount = earnings[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        earnings[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ─── VIEW HELPERS ────────────────────────────────────────────────────────
    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function getEarnings(address player) external view returns (uint256) {
        return earnings[player];
    }

    // ─── ADMIN ───────────────────────────────────────────────────────────────
    function setFee(uint256 bps) external onlyOwner {
        require(bps <= 500, "Max 5%");
        platformFeeBps = bps;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // Allow contract to receive ETH (for any edge cases)
    receive() external payable {}
}
