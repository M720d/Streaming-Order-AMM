# Screenshots for the report (Appendix A.3)

`docs/report.pdf` embeds every file below that exists in this folder, in this order; missing ones are skipped. Etherscan blocks automated
capture (Cloudflare), so take the Etherscan ones in a normal browser. Use the full-page or a clear window capture, PNG.

| File | What to capture |
|---|---|
| `app_01_pool_and_preview.png` | (present) the app on Sepolia: pool, Chainlink price, create-order form and preview |
| `app_02_confirmation_dialog.png` | the app's "Review order" confirmation dialog, before signing |
| `app_03_order_progress.png` | an order card with the progress bar part-way or finished, with Claim visible |
| `etherscan_pool_verified.png` | https://sepolia.etherscan.io/address/0x9461fd23335242663ddf7a9fae994995df7fc8e9#code with the green "verified" tick |
| `etherscan_orderbook_verified.png` | .../address/0x9c20dbb0bb17a0532348e69502af3b8b44fefa62#code |
| `etherscan_priceguard_verified.png` | .../address/0xe52d276bec7b96bcdd0632050cad5717956289df#code |
| `etherscan_mockwbtc_verified.png` | .../address/0x2c95a78b3a3fc73c16bdd6394bfe30cc51d37d12#code |
| `etherscan_mockusdc_verified.png` | .../address/0x9cd5587b22d15790a5880d37837cdd091c9ea0b5#code |
| `etherscan_tx_createOrder.png` | .../tx/0x9d02d4bd8eafa36b097c0b0133eafe97f42ec78ed9b9e90962c2c5d9f5460307 |
| `etherscan_tx_executeSlice.png` | .../tx/0x5e2d57674c0b396c4c36d080436d7d655d7cc986467b3a595591e76c3f63afa7 |
| `etherscan_tx_claim.png` | .../tx/0x3253d705d0c7c4d5633fd983e26305148e25705e0e27c19a1d67eab341b2b91a |

After adding files, the report is rebuilt from `docs/report.md` plus these images (ask the assistant, or re-run the build).
