# Instant Sync — 2-minute demo

**Setup before recording:** wallet service on `127.0.0.1:8787` (testnet), Instant Sync server running (local `npm start` on 8795 (`PORT=8795`) or the deployed URL), `frontend/.env.local` has `NEXT_PUBLIC_WALLET_BACKEND=live` and `NEXT_PUBLIC_INSTANT_SYNC_URL`, dev server restarted. The demo wallet is funded on testnet. Keep a second browser profile or the Fauzec faucet ready to send a payment. Screen: app on the left, a terminal tailing `instant-sync` logs on the right.

The badge under the balance shows the timer: `Synced in X.Xs · local` or `Synced in X.Xs · instant`. It measures from opening the wallet view to the first balance on screen.

> Note: this build cannot restore a phrase into the funded wallet (see README). The "cold open" below is lock → unlock → reload, which forces the wallet to catch up before it can show a balance.

| Time | Show | Say |
|---|---|---|
| 0:00 | Landing, then Settings → Instant Sync **Off** | "Zeno is a shielded Zcash wallet. Opening it means scanning the chain before you see a balance." |
| 0:15 | Lock the wallet, unlock, open Wallet. Badge: `Synced in N.Ns · local` | "Instant Sync off: we wait for local sync. That's N seconds." |
| 0:35 | Settings → Instant Sync **On**. Read the one-line explainer aloud | "It shares only the viewing key, never the spending key. Testnet beta." Terminal shows `registered <id>`. |
| 0:50 | Wait for first sync (`/v1/state` → `ready`), lock, unlock, open Wallet. Badge: `Synced in 0.Xs · instant` (green). Ironwood row visible | "Same wallet, same cold open: balance and history render from the server instantly. The Ironwood pool is shown on its own row." |
| 1:10 | Point at "verifying locally…" changing to the sync label | "Local sync still runs. When it finishes, local numbers win. Spending only ever uses local state." |
| 1:20 | Send a shielded testnet payment to the demo wallet (second profile, or Fauzec faucet) | "Now a new payment arrives." |
| 1:35 | After the next block (~75 s on testnet; cut the wait), reload: new balance appears with `· instant` | "The server picked it up on its 30-second resync, so it's there the moment the app opens." |
| 1:50 | Settings → Instant Sync **Off** | "Turning it off deletes the server's copy." |

NEAR Intents swaps are not used in the demo: 1Click has no testnet deployment, so a swap can't be shown end to end on testnet.

## Roadmap

1. **Nitro Enclave + attestation.** Run the sync server inside an AWS Nitro Enclave on the same c6i instance (enabled at launch). The client checks the attestation document (PCRs) before registering, the UFVK reaches the enclave over the attested channel instead of argv, and `/data` is sealed with a KMS key bound to the enclave measurements, so the operator can't read viewing keys.
2. **IVK-only mode.** Register an incoming viewing key instead of a full viewing key. The server can show received funds and history but cannot see spends. Balance becomes "received" rather than "spendable", which is the right trade for users who only want fast receive notifications.
3. **PCZT-based spending.** Let the server build a partially constructed Zcash transaction (PCZT) from its synced state, and have the local wallet only prove and sign. Spending becomes fast too, while the spending key still never leaves the device.
4. **Migration to Tachyon oblivious sync.** When Tachyon's oblivious synchronization lands, swap the viewing-key server for one that serves wallet state without learning which notes belong to the user. This removes the need to trust the sync server with a viewing key at all.
