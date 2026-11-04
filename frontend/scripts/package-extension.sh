#!/usr/bin/env bash
# Zip ../extension into public/downloads so the landing page can offer it.
# The zip holds one folder, zeno-wallet-extension/, ready for chrome://extensions → Load unpacked.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/../extension"
out="$here/public/downloads/zeno-wallet-extension.zip"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/zeno-wallet-extension" "$(dirname "$out")"
cp -R "$src"/manifest.json "$src"/popup.html "$src"/popup.css "$src"/popup.js "$src"/icons "$src"/README.md "$stage/zeno-wallet-extension/"
find "$stage" -name .DS_Store -delete
rm -f "$out"
(cd "$stage" && zip -qrX "$out" zeno-wallet-extension)
echo "wrote $out ($(wc -c < "$out" | tr -d ' ') bytes)"
