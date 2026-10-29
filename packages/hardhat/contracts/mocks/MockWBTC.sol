//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test WBTC with 8 decimals. Owner can mint any amount; anyone can use the capped faucet.
contract MockWBTC is ERC20, Ownable {
    /// @notice Maximum amount a single faucet call can mint (5 WBTC).
    uint256 public constant FAUCET_CAP = 5e8;

    error FaucetCapExceeded(uint256 amount, uint256 cap);

    constructor(address initialOwner) ERC20("Mock Wrapped BTC", "mWBTC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet(uint256 amount) external {
        if (amount > FAUCET_CAP) revert FaucetCapExceeded(amount, FAUCET_CAP);
        _mint(msg.sender, amount);
    }
}
