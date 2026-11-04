#!/bin/sh
# Builds the submission zip from the current working tree. Run from anywhere:
#   sh docs/make-submission-zip.sh [output.zip]      (default: ~/Downloads/StreamingOrderAMM_submission.zip)
# Brightspace needs only the two files in UPLOAD_TO_BRIGHTSPACE/. The rest is the supporting material the grading text asks for.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/Downloads/StreamingOrderAMM_submission.zip}"
VIDEO="${VIDEO:-$HOME/Downloads/StreamingOrderAMM_submission/final_project_demo.mov}"   # the demo video; kept out of git because of its size
STAGE="$(mktemp -d)/StreamingOrderAMM_submission"
mkdir -p "$STAGE/UPLOAD_TO_BRIGHTSPACE" "$STAGE/source" "$STAGE/analysis/data" "$STAGE/metadata" "$STAGE/screenshots"

cp "$ROOT/docs/report.pdf" "$ROOT/submission.json" "$STAGE/UPLOAD_TO_BRIGHTSPACE/"
cp "$ROOT/docs/source-code.pdf" "$STAGE/source/"
cp -R "$ROOT/packages/hardhat/contracts" "$STAGE/source/contracts"
rm -f "$STAGE/source/contracts/mocks/MockPool.sol" "$STAGE/source/contracts/mocks/ReentrantReceiver.sol" "$STAGE/source/contracts/mocks/PriceMathHarness.sol" "$STAGE/source/contracts/mocks/MockAggregator.sol"
cp -R "$ROOT/packages/hardhat/scripts" "$STAGE/source/offchain-scripts"
cp "$ROOT"/docs/analysis_*.ipynb "$STAGE/analysis/"
cp "$ROOT"/docs/data/*.json "$STAGE/analysis/data/"
cp -R "$ROOT/docs/figures" "$STAGE/analysis/figures"
cp "$ROOT/packages/hardhat/deployments.json" "$STAGE/metadata/"
cp -R "$ROOT/packages/hardhat/deployments/sepolia" "$STAGE/metadata/abi-and-compiler-metadata"
cp "$ROOT"/docs/screenshots/*.png "$STAGE/screenshots/" 2>/dev/null || true
if [ -f "$VIDEO" ]; then mkdir -p "$STAGE/video" && cp "$VIDEO" "$STAGE/video/"; else echo "WARNING: no video at $VIDEO (set VIDEO=path)"; fi

cat > "$STAGE/README.txt" <<'EOF'
Streaming-Order AMM - FRE-GY 6931 final project submission package
Team: Aditya Shah (as22008), Siddhant Yadav (sy4583), Dev Salvi (ds8259)
Repository: https://github.com/M720d/Streaming-Order-AMM (graded version: tag "final")

UPLOAD_TO_BRIGHTSPACE/  report.pdf and submission.json (the two files the course brief asks one member to upload)
source/                 Solidity (contracts/, plus source-code.pdf with line numbers) and the off-chain scripts
analysis/               the three Python notebooks, their charts and the data files they read
metadata/               deployments.json (addresses, deployment txs) and per-contract ABI and compiler metadata from Sepolia
screenshots/            Etherscan screenshots (verified contracts, transactions) and the application
video/                  the narrated demo on Sepolia (final_project_demo.mov)

All contracts are deployed and verified on Ethereum Sepolia; addresses are in report Section 3.5 and submission.json.
EOF

rm -f "$OUT"; mkdir -p "$(dirname "$OUT")"
(cd "$(dirname "$STAGE")" && zip -qr "$OUT" "$(basename "$STAGE")" -x '*.DS_Store')
echo "wrote $OUT"; unzip -l "$OUT" | tail -1
grep -c 'TODO' "$ROOT/submission.json" | sed 's/^/submission.json lines still marked TODO: /'
