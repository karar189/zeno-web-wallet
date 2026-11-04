# Privacy workspace

## What is implemented

The responsive app shell has an overview, payments, route previews, payment activity, and auditor-access navigation. Payment review and swap previews use the same explicit privacy requirements. No numeric anonymity score is calculated.

- **Shielded receiver required (default):** payment review stays shielded-first. Transparent testnet recipients (`tm…` / `t2…`) are allowed only after the user turns this requirement off. Live verification still means the local wallet produced a usable quote; a simulated format check alone does not count unless the requirement is relaxed.
- **Avoid external swap providers:** direct wallet payments do not use a swap provider. 1Click previews and DeFi exits fail this requirement until the user turns it off. The wallet service and lightwallet server still have visibility described in the preview.
- On payment approval the store checks the requirements again. The Rust wallet accepts transparent testnet recipients when quoted, but the testnet service still refuses mainnet addresses. Faucet funding remains on the shielded receive address.
- Overview can shield transparent UTXOs into Orchard and unshield to the wallet’s own public `tm…` address, with explicit public-output copy. Disclosure export remains shielded-only.

## NEAR Intents DeFi exit

`/swap` prices ZEC pairs through same-origin Next.js routes, then can execute a mainnet exit when the header network is Zcash mainnet and the privacy requirements allow a public provider path.

### Price (dry)

`POST /api/trade/quote` discovers assets from `GET https://1click.chaindefuser.com/v0/tokens`, then calls `/v0/quote` with `dry: true`, `EXACT_INPUT`, and 100 basis points of slippage. The form requires explicit consent before sharing the amount. Dry responses never include a deposit address. Optional `NEAR_INTENTS_API_KEY` belongs in `frontend/.env.local` on the server, without a `NEXT_PUBLIC_` prefix. JWT-shaped keys are sent as `Authorization: Bearer`; other keys as `X-API-Key`.

### Execute (mainnet only)

1. User switches the header to **Zcash mainnet**, unlocks the mainnet wallet service (`NEXT_PUBLIC_MAINNET_WALLET_URL`, default `127.0.0.1:8788`), and turns off the shielded-receiver and no-swap-provider requirements.
2. `POST /api/trade/deposit` requests a live quote (`dry: false`) with the destination address and the wallet’s transparent `t1`/`t3` refund address. The refund deadline is ~30 minutes so Zcash can mine and the bridge can confirm.
3. After the user confirms, the browser quotes and broadcasts a transparent ZEC payment from the mainnet wallet to the 1Click deposit address.
4. `POST /api/trade/notify` optionally submits the Zcash txid to 1Click. `GET /api/trade/status` polls until a terminal status (`SUCCESS`, `REFUNDED`, or `FAILED`).

The default public settlement path uses a transparent Zcash deposit and a public destination-chain output. The privacy panel stays visible and must be relaxed before prepare/send. Quotes show provider output, minimum output, estimated time when reported, and a locally imposed 60-second price freshness for dry quotes. The source-chain wallet fee is not included in the provider estimate. Testnet ZEC cannot fund a mainnet swap; the trade screen prices on any network but only prepares deposits on mainnet.

Sources checked 2026-11-04:
- [1Click quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)
- [Check swap execution status](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status)
- [Submit deposit transaction hash](https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash)
- [Supported addresses](https://docs.near-intents.org/resources/chain-support)
- [Making a request](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request)

## Payment activity and refresh recovery

Activity lists the current tab's payment attempts, not a complete scanned wallet history. Before authorization, a user may opt into a tracking receipt. Without opt-in, history stays in memory.

Opt-in writes transaction metadata (recipient, amount, fee, status, and broadcast reference) in **unencrypted sessionStorage**, scoped to the active wallet ID or to simulation mode. No seed, viewing key, or reusable approval is saved in a receipt. Receipts normally disappear when the tab is closed; browser session restoration can retain sessionStorage, so use Clear local history when necessary.

An interrupted submission is restored as **unknown**, with its proposal and authorization discarded. It cannot automatically submit again. Known broadcast references can be checked again from the status page. An unknown attempt blocks new preparation until the user checks the wallet and explicitly clears the local history. Clearing history never cancels a transaction or proves that it failed. Storage denial can prevent refresh recovery; tracking continues in memory.

## Independent auditor scanner

`/audit` imports a testnet UFVK and its exact account birthday into a separate SQLite in-memory database through `POST /api/wallet/audit/scan`. No spending session is needed; the existing loopback Host and browser Origin restrictions apply. The request requires `approved: true`. Unknown fields, seeds, mainnet keys, and spending keys are refused.

The scanner imports `AccountPurpose::ViewOnly`, retrieves compact blocks from the configured testnet lightwallet server, and reports the detected value and fully scanned height. It does not open the spending wallet or receive a seed. The database and compact-block cache are discarded after each request, and the response is `no-store`. The key stays in page memory until the scan succeeds, the form is cleared, or the page is left. It is never written to browser storage. The configured local service necessarily receives the viewing key; the lightwallet server receives chain-data requests, not the viewing key.

The prototype accepts birthdays at most 2,000 blocks behind the observed tip, permits one concurrent audit scan per process, and times out after 90 seconds. Use the original birthday; selecting a later date can omit payments. The result explicitly says whether scanning reached the tip observed at scan start. It is not a spendable-balance assertion, transaction-specific proof, or complete accounting attestation. A funded-note scan and a real outgoing testnet payment still require manual network verification. Unit tests verify testnet key decoding and importing a ViewOnly account without a seed.

## Verification

The public live asset list was checked for native ZEC and USDC on Base/Solana/Ethereum/Arbitrum/Optimism. A dry ZEC-to-USDC/Solana quote succeeded. Deposit creation, broadcast, and status polling are implemented against the mainnet wallet path; they spend real ZEC when used. Automated tests cover forced dry quotes, deposit matching, status/notify origin checks, exact units, missing assets, input and origin validation, privacy requirements, and interruption recovery.

### Checks completed on 2026-11-04

- Trade unit tests extended for live deposit deadlines and 1Click status/notify helpers.
- No user seed or viewing key was accessed during documentation of this path, and no real mainnet funds were spent in this pass.
