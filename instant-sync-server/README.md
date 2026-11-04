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
| `ENCLAVE` | `0` | `1` inside the Nitro Enclave: `/v1/attestation` returns an NSM document from `ATTEST_BIN` |
| `ATTEST_BIN` | `zeno-enclave-agent` | see `enclave/agent` |
| `REQUIRE_SEALED` | = `ENCLAVE` | refuse plaintext `{ufvk}` registrations |
| `INIT_TIMEOUT_MS` / `SYNC_TIMEOUT_MS` / `CMD_TIMEOUT_MS` | 2 min / 15 min / 1 min | child process timeouts |

## API

- `GET /v1/attestation?nonce=<hex, 16–64 bytes>` → `{attested: true, document}` in an enclave: a base64 AWS Nitro attestation document (COSE_Sign1) whose `public_key` is the server's in-memory P-256 key and whose `nonce` is yours. Outside an enclave: `{attested: false, document: null, publicKey}` (same encryption, no proof).
- `POST /v1/register {sealed: {epk, iv, ct}}` → `201 {token, status}`. `ct` is `{ufvk, birthday?, stateKey}` encrypted with ECDH P-256 → HKDF-SHA256 → AES-256-GCM (see `sealed.mjs` / `frontend/src/features/instant-sync/seal.ts`). `GET /v1/state` for such an account answers `{sealed: {iv, ct}}`, encrypted to `stateKey`.
- `POST /v1/register {ufvk, birthday?}` → `201 {token, status}`. Only `uviewtest1…` keys; spending keys, seed phrases and mainnet keys get 400. Body ≤ 8 KB. 5 successful registrations per hour per IP.
- `GET /v1/state` (`Authorization: Bearer <token>`) → cached `{status, balance, txs, chainTipHeight, lastSyncedAt, stalenessMs, firstSyncMs, lastSyncMs, error}`. `status` is `registering | syncing | ready | error`. Balances are zatoshi strings.
- `DELETE /v1/account` (Bearer) → kills any running sync and deletes the wallet dir.
- `GET /health`.

## What is stored

- `DATA_DIR/wallets/<id>/`: the zcash-devtool view-only wallet. It contains the UFVK (needed to sync). `<id>` = first 32 hex chars of `sha256(token)`.
- `DATA_DIR/accounts.json`: status, timings, cached balance and txids. No UFVK, no token.
- The token itself is only returned once, to the client. The server keeps its hash.
- Logs never include UFVKs or tokens; errors from devtool are redacted before they are logged or returned.

## Nitro Enclave mode

TLS terminates on the parent instance (Caddy), so it does not protect anything from the operator. The enclave layer does:

1. The client sends a fresh nonce to `/v1/attestation` and verifies the document in the browser (`frontend/src/features/instant-sync/attestation.ts`): the chain to the pinned AWS Nitro root (SHA-256 `641a0321…79bb5b`), every certificate signature and validity period, the ES384 COSE signature, the nonce, freshness, and that PCR0/1/2 equal `frontend/src/features/instant-sync/enclave-measurements.json`. Debug-mode enclaves (all-zero PCRs) are rejected.
2. Only then does it encrypt the viewing key to the `public_key` in that document. The key pair is created in enclave memory at startup and never leaves it.
3. State comes back encrypted to a key only the browser and the enclave hold. The parent sees bearer tokens and ciphertext sizes and timing, nothing else.
4. Wallet data lives in enclave RAM. Restarting the enclave wipes it; clients get 401 and re-register.
5. Outbound traffic goes only to lightwalletd, through `vsock-proxy` on the parent with an allowlist. TLS to lightwalletd terminates inside the enclave.

When `enclave-measurements.json` has PCRs, the client has **no fallback**: if attestation fails, Instant Sync does not register.

### Reproducible build

`enclave/build.sh` builds the EIF from a clean `git archive` of the last commit that touched the enclave inputs, with:
- base images pinned by digest, zcash-devtool pinned to a full commit, every crate pinned by `Cargo.lock`, and BuildKit pinned (`moby/buildkit:v0.17.3`)
- no package managers in the image
- `SOURCE_DATE_EPOCH` from that commit, plus buildx `rewrite-timestamp`

It writes `enclave/measurements.json` (PCRs, source commit, devtool ref, allowed origin, nitro-cli version, and a hash of its kernel/init blobs) and the frontend copy. Anyone can check a deployment:

```bash
cd instant-sync-server && ./enclave/build.sh --verify   # rebuilds; fails unless PCR0/1/2 match the committed file
```

PCR0 also depends on the nitro-cli blobs, so verify with the same `nitroCli` version recorded in the file.

## Known v0 limits

- **The UFVK appears in the child process argv** (`init-fvk --fvk …`). On a normal host any local user can see it in `ps`; inside the enclave there are no other users.
- On a **non-enclave** server the operator can read every registered viewing key from disk. Use the enclave build for anything beyond local development.
- Enclave mode does not hide *that* an account exists, when it syncs, or the size of responses. The operator can also deny service (for example by deleting accounts, since it sees bearer tokens).
- Viewing keys reveal all incoming and outgoing shielded activity for the account, including future activity, and cannot be revoked. `DELETE` removes this server's copy only.
