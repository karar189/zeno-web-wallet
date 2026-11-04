# Zeno Wallet extension (dev build)

A Manifest V3 popup that frames `http://localhost:3000/popup`, the same wallet core the dashboard embeds. One UI codebase; the extension holds no wallet logic.

## Load it

1. Run the wallet service on `127.0.0.1:8787` and the frontend on `localhost:3000` (see the root README). Optional: the Instant Sync server.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this `extension/` folder.
3. Pin Zeno from the puzzle-piece menu and click the icon.

## What works in the popup

- Unlock or create a wallet, lock.
- Balance (with Instant Sync if it's on), shielded and transparent addresses, copy, faucet, shield.
- Receive with QR.
- **Send → Review → Status** inside the popup, with a compact header and a back button to the wallet.
- **Expand** (top-right) opens the full dashboard in a tab. Any other link (Auditor, Settings, Activity…) also opens in a tab.

## How it fits together

- The popup frame keeps the `http://localhost:3000` origin, so the wallet service's origin allowlist needs no change.
- Tested in Chromium 1243 with this extension loaded: the framed page reads the **same** localStorage and IndexedDB as a normal `localhost:3000` tab (the extension's `host_permissions` for `localhost:3000` keep storage unpartitioned). So the popup and the dashboard share one vault and one session.
- "Popup mode" is a per-frame `sessionStorage` flag set by `/popup`; `AppShell` swaps the dashboard chrome for the compact one only inside the frame.

## Limits

- Needs the local app running; if `localhost:3000` is down the popup shows a hint instead.
- Not tested in Brave, Arc or Firefox. Brave's shields may block the frame; allow `localhost` if so.
- No `chrome.storage`, no background worker, no dapp provider injection (sites can't request payments from it yet).
