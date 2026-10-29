//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test USDC with 6 decimals. Owner can mint any amount; anyone can use the capped faucet.
contract MockUSDC is ERC20, Ownable {
    /// @notice Maximum amount a single faucet call can mint (500,000 USDC).
    uint256 public constant FAUCET_CAP = 500_000e6;

    error FaucetCapExceeded(uint256 amount, uint256 cap);

    constructor(address initialOwner) ERC20("Mock USD Coin", "mUSDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet(uint256 amount) external {
        if (amount > FAUCET_CAP) revert FaucetCapExceeded(amount, FAUCET_CAP);
        _mint(msg.sender, amount);
    }
}
