# instant-sync-server (v0, testnet)

Keeps a user's **viewing key** synced with [zcash-devtool](https://github.com/zcash/zcash-devtool) so the web wallet can show balance and history the moment it opens. The local wallet service stays the source of truth for spending.

Node 22+, ESM, no npm dependencies.

## Run

```bash
# build the sync engine once
git clone https://github.com/zcash/zcash-devtool && cd zcash-devtool && cargo build --release

cd instant-sync-server
DEVTOOL_BIN=/path/to/zcash-devtool/target/release/zcash-devtool npm start
npm test   # smoke test with a mock devtool, no network
```

| Env | Default | Notes |
|---|---|---|
| `PORT` | `8790` | 8787/8788 are the local wallet services |
| `HOST` | `0.0.0.0` | |
| `DEVTOOL_BIN` | `zcash-devtool` | path to the binary |
| `DATA_DIR` | `./data` | created with mode 700 |
| `LWD_SERVER` | `zecrocks` | passed as `-s` (testnet keys → testnet.zec.rocks) |
| `SYNC_INTERVAL_MS` | `30000` | background resync per account |
| `SYNC_CONCURRENCY` | `1` | parallel devtool syncs |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | single CORS origin |
| `MAX_ACCOUNTS` | `100` | |
| `ALLOW_MAINNET` | `0` | keep 0; `uview1` keys are refused |
| `BALANCE_MIN_CONFIRMATIONS` | `1` | passed to `balance --min-confirmations`; matches the local wallet service on testnet (devtool's own default is 3/10) |
| `TRUST_PROXY` | `0` | set 1 behind Caddy so rate limits use `X-Forwarded-For` |
| `INIT_TIMEOUT_MS` / `SYNC_TIMEOUT_MS` / `CMD_TIMEOUT_MS` | 2 min / 15 min / 1 min | child process timeouts |

## API

- `POST /v1/register {ufvk, birthday?}` → `201 {token, status}`. Only `uviewtest1…` keys; spending keys, seed phrases and mainnet keys get 400. Body ≤ 8 KB. 5 successful registrations per hour per IP.
- `GET /v1/state` (`Authorization: Bearer <token>`) → cached `{status, balance, txs, chainTipHeight, lastSyncedAt, stalenessMs, firstSyncMs, lastSyncMs, error}`. `status` is `registering | syncing | ready | error`. Balances are zatoshi strings.
- `DELETE /v1/account` (Bearer) → kills any running sync and deletes the wallet dir.
- `GET /health`.

## What is stored

- `DATA_DIR/wallets/<id>/`: the zcash-devtool view-only wallet. It contains the UFVK (needed to sync). `<id>` = first 32 hex chars of `sha256(token)`.
- `DATA_DIR/accounts.json`: status, timings, cached balance and txids. No UFVK, no token.
- The token itself is only returned once, to the client. The server keeps its hash.
- Logs never include UFVKs or tokens; errors from devtool are redacted before they are logged or returned.

## Known v0 limits

- **The UFVK appears in the child process argv** (`init-fvk --fvk …`), so any user on the box can see it in `ps` while init runs. Acceptable for a single-tenant v0 host; the enclave version should pass it over stdin or a vsock channel.
- The operator can read every registered viewing key from disk. That is the trust model of v0; the Nitro Enclave version moves keys out of operator reach.
- Viewing keys reveal all incoming and outgoing shielded activity for the account, including future activity, and cannot be revoked. `DELETE` removes this server's copy only.
