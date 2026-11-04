# Shielded payments

Testnet shielded sends from the local wallet service. There is no contract deploy.

Two payment modes exist in the frontend:

- **Simulated send**, the default. `NEXT_PUBLIC_WALLET_BACKEND` is unset or `simulated`. The send orchestrator uses a fixture balance and fee. Submit returns a `sim_…` reference. Nothing is broadcast.
- **Live send.** `NEXT_PUBLIC_WALLET_BACKEND=live` and `NEXT_PUBLIC_WALLET_URL` (default `http://127.0.0.1:8787`). Prepare and send go to the wallet service with the bearer token from [wallet.md](./wallet.md).

That flag does not change funding, the dashboard balance, disclosure, or receive. Those call the wallet service whenever a session exists. Receive has no fixture address.

The payment engine on port 4010 is a third process. It records requests and always refuses submission. No current page calls it. Do not treat its blocker text as the wallet service's status.

Live prepare refuses to continue when the service reports `canSubmit: false`, unless the blocker says the balance is locked by an open quote and the scan is still synced. In that case the page can still authorize the quote that holds the notes.

## Wallet-service routes that move money

All of these require an allowed `Origin`, a loopback `Host`, and `Authorization: Bearer`. Request bodies that contain seed or spending-key fields are rejected. The service does not accept a phrase on quote or send.

| Method | Path | Role |
|---|---|---|
| `GET` | `/api/wallet/readiness` | Sync, detected zatoshis, spendable zatoshis, `canSubmit`, blocker |
| `GET` | `/api/wallet/address` | Default shielded unified testnet address, optional `transparentAddress` (`tm…`), and birthday |
| `POST` | `/api/wallet/shield/quote` | Quote shielding spendable transparent UTXOs into Orchard |
| `POST` | `/api/wallet/shield/send` | Approve and broadcast a shield quote (same approval fields as send) |
| `POST` | `/api/wallet/sync` | Scan toward the lightwalletd tip |
| `POST` | `/api/wallet/quote` | `{ recipient, amountZatoshis }` |
| `POST` | `/api/wallet/send` | `{ quoteId, approved: true, recipient, amountZatoshis, feeZatoshis }` |
| `GET` | `/api/wallet/transactions/:txid` | Confirmation and recipient detection |
| `GET` | `/api/wallet/faucet/info` | Faucet status plus this wallet's address |
| `POST` | `/api/wallet/faucet/claim` | `{ requestId, captchaToken? }` |
| `POST` | `/api/wallet/instant-sync/viewing-key` | `{ approved: true }` → primary account `{ ufvk, birthday }` for the opt-in Instant Sync server. Testnet only; never returns a spending key |
| `GET` | `/api/wallet/faucet/status/:request_id` | Faucet status for that UUID. The address in the faucet response must match the wallet |

`LIGHTWALLETD_ENDPOINT` has to be set for sync, quote, send, and account creation. The service refuses a lightwalletd chain name that does not look like testnet, including any name that contains `main`.

`synced` means the wallet's scanned height is within 10 blocks of the tip. `canSubmit` also needs a non-zero spendable balance and a seed in memory. Spendable balance uses `ConfirmationsPolicy::default()` from the Zcash client library. This pass did not re-derive that policy's confirmation count.

## Quote and send

- `propose_transfer` supplies the fee. Inputs are locked for 30 blocks.
- The quote is bound to recipient, amount, and fee, and expires 10 minutes after it is created.
- Send must repeat those three values and `approved: true`. The UI sets `approved` only from the review action.
- The quote is removed when send starts. Repeating the quote id reads `send-journal.json` instead of building again.
- Journal states: `Building`, `Prepared`, `Accepted`, `Indeterminate`, `Interrupted`, `Rejected`. Writes are atomic.
- On startup, `Building` becomes `Interrupted` and is not broadcast. `Prepared` with stored transaction ids is broadcast again. `Indeterminate` and `Interrupted` are returned as indeterminate and are not broadcast again.
- The UI does not retry an indeterminate submit.
- Proof and signing durations are not shown. The page records proposal work as unavailable and says proof and signing happen inside send.

`submitted` requires a transaction id from an accepted broadcast. `confirmed` requires lightwalletd to report the transaction mined. Recipient detection runs only after that, against the requested recipient. A failed status check stays unconfirmed. Simulated and live samples are not mixed. The lab withholds p95 below 20 samples. The lab itself is an in-browser simulation at `/pay/lab`.

## Funding

The panel is `/wallet`. Phases are Ready to request, Request submitted, Waiting for funds, Funds detected, Spendable, and Failed.

**Funds detected** requires the wallet's detected balance to exceed the baseline stored before the claim. **Spendable** also requires the spendable balance to exceed its baseline and `canSubmit: true`. Faucet states `pending`, `broadcasting`, `confirmed`, `failed`, and `unknown` do not replace that balance check. HTTP 202, timeouts, and 5xx stay ambiguous rather than successful.

When the faucet info says a captcha is required, the panel does not POST a claim. It watches the balance and opens the faucet URL. The watch does not prove that a faucet claim exists.

One claim is in flight inside the service. The stored browser record is `localStorage` key `emperor.faucet.claim.v1` and is limited to public claim fields.

`https://testnet.zec.rocks:443` was checked on 2026-10-26 and reported lightwalletd `v0.5.4` and network `test`. That check was not repeated for this documentation pass. Public endpoints change.

## Receive

`/pay/receive` loads the shielded address from `GET /api/wallet/address` as the primary QR. The same response may include a secondary transparent (`tm…`) address, labeled public. Faucet funding still uses the shielded address. If the service is locked or down, the page has no address to show. There is no fixture address.

Quote and send accept shielded or transparent testnet recipients. Transparent sends create a public output; the review UI requires turning off the shielded-receiver requirement before approve. The testnet service refuses mainnet addresses.

## Pay by Zcash name

The send form accepts Zcash Names (`alice.zcash` / `alice.zec`). The Next.js route `GET /api/names/resolve` uses `zcashname-sdk` against the public ZNS indexer (testnet by default). Resolution happens before prepare; the resolved unified address is what quote/send use. Review shows the name and the resolved address. Name lookup is read-only public data and does not invent a new payment protocol.

## Evidence

Outgoing shielded sends from the demo wallet are on public testnet: `c2267ce983ca1f530015b13424f7bfc9090cbfe4eccffae41779594089150c76` (0.0101 TAZ) and `fdf1921e895c9472426d787402c8cf23b1d17269011068bb3c450320ac8f9eea` (0.20015 TAZ), both with Ironwood change. The funding receipt is `f9dbb8bb655113e6d1f65efe3bfc4e8202bb3b375e96ec7ed2fbc55968c7d689`. Instant Sync independently found all three from the account's viewing key.

## Not claimed

- No verified mainnet payment. The mainnet service exists but has not been run with a funded wallet.
- No change to Zcash block times.
- The experimental probe in `engine/crates/experimental-optimizer` is not on the payment path and is not Project Tachyon.
- The port 4010 process cannot broadcast, even when the wallet service can.
