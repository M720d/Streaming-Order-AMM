//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IOrderBook } from "../interfaces/IOrderBook.sol";

/// @notice Test contract that creates an order and, when the order NFT is minted to it, calls back into a target
///         with arbitrary calldata and records whether that call succeeded. Never deploy outside tests.
contract ReentrantReceiver is IERC721Receiver {
    address public attackTarget;
    bytes public attackData;
    bool public attacked;
    bool public attackSucceeded;
    bytes public attackRevertData;

    function setAttack(address target_, bytes calldata data_) external {
        attackTarget = target_;
        attackData = data_;
    }

    function approveAndCreate(
        IERC20 token,
        IOrderBook book,
        uint256 totalIn,
        uint32 slices,
        uint32 interval,
        uint16 toleranceBps
    ) external returns (uint256) {
        token.approve(address(book), totalIn);
        return book.createOrder(totalIn, slices, interval, toleranceBps);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external override returns (bytes4) {
        if (attackTarget != address(0)) {
            attacked = true;
            (attackSucceeded, attackRevertData) = attackTarget.call(attackData);
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
