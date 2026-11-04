# Engine

Two different Rust projects live here. Only the payment engine is a member of this Cargo workspace. The wallet service is excluded and documented in the [repository README](../README.md) and [docs/wallet.md](../docs/wallet.md).

## Workspace members

`cargo test` and `cargo run -p payment-api` from this directory use:

- `services/payment-api` — HTTP process below
- `crates/api-types`
- `crates/wallet-core` — recipient and amount checks
- `crates/zcash-adapter` — `BlockedAdapter`, always unable to submit
- `crates/payment-orchestrator`
- `crates/benchmark-engine`
- `crates/experimental-optimizer` — an isolated probe. It is not on a payment path and is not Project Tachyon

`services/wallet-service` has its own `Cargo.toml` and its own lockfile. Run it from that directory. It is the process that can sync, prove, sign, and broadcast testnet shielded transactions.

The workspace source contains 14 test functions. They were not run for this documentation pass. A full `cargo test` compiles these crates. It does not compile the wallet service.

## Payment API

```bash
cargo run -p payment-api
```

Listens on `127.0.0.1` and `PORT` (default `4010`). `ENGINE_DB` is the SQLite file, default `engine.sqlite` in the current directory. CORS allows `http://localhost:3000` and `http://127.0.0.1:3000`.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/health` | `{ "ok": true }` |
| `GET` | `/capabilities` | `canSubmit: false`. Blocker: "No verified Zcash SDK is connected. Shielded testnet submission is not available." |
| `POST` | `/payment-requests` | Stores recipient, amount, and expiry after a testnet shielded prefix and character check. No checksum. Refuses bodies that contain seed or spending-key fields. |
| `GET` | `/payment-requests/:id` | Reads one stored request. Still `canSubmit: false`. |
| `POST` | `/benchmarks` | Stores a JSON object. |
| `POST` | `/payments/prepare` | `outcome: "blocked"`, null reference. |
| `POST` | `/payments/submit` | `outcome: "rejected"`, null reference. Not a transaction id. |

No current frontend page calls this process. `frontend/src/components/payments/engine-report.tsx` would read `/capabilities`, and it is not mounted.

This process has no route to wallet files and no broadcast client. The blocker string describes this adapter. It does not describe the wallet service.
