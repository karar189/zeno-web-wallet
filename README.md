# Zeno Wallet

**A Zcash testnet wallet that shows you exactly what others can see before you pay. Shielded by default, signed on your machine, and instant to open.**

Built for the Free Society Hack 2026 (Mumbai), Privacy track. Theme: *The first five minutes*, with viewing-key work from *Privacy beyond the transaction*. Testnet only.

## The problem

Zcash's privacy depends on choices most users never see.

- Measured usage has been mostly transparent: 73.5% transparent vs 6.3% shielded transactions in [Kappos et al., USENIX Security 2018](https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-kappos.pdf).
- Shielded supply grew from about 11% to about 30% in 2025, but mostly through partially shielded flows; fully shielded transfers stay a small share ([Coin Metrics](https://coinmetrics.substack.com/p/state-of-the-network-issue-338), [Messari](https://messari.io/report/understanding-zcash-a-comprehensive-overview)).
- Users get stuck or confused by transparent funds: [coinbase rewards stuck in a t-address](https://forum.zcashcommunity.com/t/coinbase-rewards-sent-to-transparent-vs-shielded/43876), ["How do you communicate all of these subtleties to a user…"](https://forum.zcashcommunity.com/t/why-does-zashi-only-allow-1-transparent-address/51538), [exchange withdrawals arrive transparent](https://zechub.substack.com/p/private-vs-transparent).
- Viewing keys exist, but [no tooling turns one into something an accountant can use](https://forum.zcashcommunity.com/t/is-anyone-actually-using-viewing-keys-for-business-accounting/56300).
- Shielded wallets are slow to open: they scan the chain before showing a balance.

**Who it's for:** someone making their first shielded payments, often with ZEC that arrived transparent from an exchange.

## What Zeno does

1. **Shielded by default.** Receive, send and faucet funding use the shielded unified address. Transparent is opt-in and labeled public. Shield transparent funds in one tap.
2. **Privacy review before every send.** Plain-language checks: shielded receiver, swap provider involvement, fee, and what your network connection still reveals. Requirements are re-checked at approval.
3. **Pay by name.** `alice.zcash` resolves through the Zcash Names indexer into the same review.
4. **Viewing keys, scoped.** Export a viewing key for a *dedicated* account and scan it read-only at `/audit`.
5. **Instant Sync (opt-in).** A sync server keeps your viewing key synced, so balance and history render the moment the app opens. Local sync stays the source of truth and is the only thing used for spending. See [instant-sync-server/](./instant-sync-server/README.md).
6. **Wallet everywhere.** The same wallet panel runs on the dashboard, in the header, and as a browser-extension popup ([extension/](./extension/README.md)).

## Evidence (testnet)

Found by Instant Sync from the demo wallet's viewing key, on public Zcash testnet via `testnet.zec.rocks`:

| txid | Mined | What |
|---|---|---|
| `f9dbb8bb655113e6d1f65efe3bfc4e8202bb3b375e96ec7ed2fbc55968c7d689` | 4,560,716 | Received 1.00 TAZ, Ironwood |
| `c2267ce983ca1f530015b13424f7bfc9090cbfe4eccffae41779594089150c76` | 4,561,446 | Sent 0.0101 TAZ, shielded (Ironwood change) |
| `fdf1921e895c9472426d787402c8cf23b1d17269011068bb3c450320ac8f9eea` | 4,561,983 | Sent 0.20015 TAZ, shielded (Ironwood change) |

Instant Sync first sync for this wallet: **41.7 s** from birthday to ready; cached state then serves in ~2 ms. Ironwood spendable reported: 0.78975 TAZ, matching the two sends.

<!-- TODO before submitting: add the shielded txid sent during the hack on 2026-11-04 here. -->

## Privacy and trust

- **On chain:** for shielded-to-shielded sends, sender, recipient, amount and memo are encrypted. Transparent sends are public, and the app says so before you approve.
- **Seed:** encrypted in the browser (IndexedDB). Decrypted only by the wallet service on `127.0.0.1`, in memory, while unlocked. It never leaves your machine.
- **Local data:** the wallet service keeps its wallet database under `wallet-data/` on your machine. There is no Zeno account, analytics, or remote log.
- **lightwalletd (`testnet.zec.rocks`)** sees your IP address, when you sync, and the bytes of transactions you broadcast. It cannot decrypt shielded notes.
- **Instant Sync (off by default):** turning it on sends your primary account's **viewing key** (never a spending key) to the sync server. The operator can then see all of that account's shielded activity, including future activity, and a viewing key cannot be revoked. The server stores the key in its devtool wallet dir, plus cached balance and txids; it stores only a hash of your access token and never logs keys. Turning the toggle off deletes the server's copy. The server can run in an **AWS Nitro Enclave**: the app verifies the enclave's attestation in the browser against PCRs from a [reproducible build](./instant-sync-server/README.md#reproducible-build), then encrypts the viewing key to a key that exists only inside the enclave. In that mode the operator cannot read keys, balances or txids. A non-enclave dev server is labeled "not attested" in Settings.
- **You trust:** your own machine, the Zcash libraries (`librustzcash`, `zcash-devtool`), the lightwalletd operator not to link your IP to your activity, and anyone you give a viewing key to (including the Instant Sync operator if enabled).
- **Not covered yet:** network-level privacy (see next steps).

## Run it locally

Prerequisites: Node 22+, Rust (stable), internet access to `testnet.zec.rocks`.

```bash
# 1. Wallet service (testnet, loopback only)
cd engine/services/wallet-service
WALLET_NETWORK=testnet WALLET_API_BIND=127.0.0.1:8787 WALLET_DATA_DIR=$PWD/wallet-data \
LIGHTWALLETD_ENDPOINT=https://testnet.zec.rocks:443 cargo run --release

# 2. Frontend
cd frontend
cp .env.example .env.local        # set NEXT_PUBLIC_WALLET_BACKEND=live
npm install && npm run dev         # http://localhost:3000

# 3. Optional: Instant Sync server
git clone https://github.com/zcash/zcash-devtool && (cd zcash-devtool && cargo build --release)
cd instant-sync-server
PORT=8795 HOST=127.0.0.1 DEVTOOL_BIN=/path/to/zcash-devtool/target/release/zcash-devtool npm start
# add NEXT_PUBLIC_INSTANT_SYNC_URL=http://127.0.0.1:8795 to frontend/.env.local, restart the frontend,
# then Settings → Instant Sync → On
```

Open the app at `http://localhost:3000` (not `127.0.0.1`; that is the only origin the services accept). Create or unlock a wallet, fund it from the faucet panel, then send from **Send**.

`NEXT_PUBLIC_WALLET_BACKEND` unset or `simulated` gives a click-through UI that never broadcasts. `NEXT_PUBLIC_*` values are read at startup; restart after changing them.

## Services

| Service | Directory | Listens | Role |
|---|---|---|---|
| Frontend | `frontend/` | `3000` | Next.js 16 UI, dashboard, `/popup` for the extension |
| Wallet service | `engine/services/wallet-service/` | `127.0.0.1:8787` | Seed, sync, faucet proxy, quote, prove, sign, broadcast, disclosure, viewing-key export for Instant Sync |
| Instant Sync server | `instant-sync-server/` | `8795` locally (`PORT`) | Viewing-key sync with zcash-devtool, cached state API |
| Extension | `extension/` | — | MV3 popup that frames `localhost:3000/popup` |
| Backend API | `backend/` | `4000` | Legacy Nest scaffold; returns empty quotes. Not needed |
| Payment engine | `engine/` workspace | `4010` | Records requests, never broadcasts. Not used by any page |

The wallet service refuses non-loopback binds, non-loopback `Host`, and any `Origin` other than `http://localhost:3000` / `http://127.0.0.1:3000`. **Never expose port 8787**: create/unlock are not behind a bearer token.

## Status

| Area | Status |
|---|---|
| Create, unlock, lock a testnet wallet | Working |
| Shielded sync, quote, sign, broadcast | Working; outgoing shielded sends on testnet (txids above) |
| Ironwood (NU7) notes | Received and spent; Instant Sync reports `ironwood_spendable` |
| Faucet funding, shield / unshield, transparent opt-in | Working on testnet |
| Pay by Zcash name | Working via `zcashname-sdk` |
| Dedicated-account viewing-key export, read-only auditor | Working; funded-note decryption in the auditor not demonstrated |
| Instant Sync | Working against real testnet with the funded wallet; default off |
| Extension popup | Built; not yet loaded in Chrome. Popup storage may be partitioned from the tab (see extension README) |
| Phrase import into the funded wallet, ZIP 311 disclosure, viewing-key revocation | Not implemented |
| Mainnet service and NEAR Intents swap exit (`/swap`) | Exist in code but are **outside this submission** (the track is testnet only) and not exercised with funds |

## Technologies

- **Wallet service:** Rust, axum, tonic, `zcash_client_backend` 0.25, `zcash_client_sqlite`, `zcash_keys`, `zcash_protocol`, `zcash_address`, Argon2id + ChaCha20-Poly1305 for the seed vault
- **Sync engine:** [zcash-devtool](https://github.com/zcash/zcash-devtool) (view-only wallets, `init-fvk` / `sync` / `balance --json` / `list-tx --json`)
- **Instant Sync server:** Node 22, built-ins only; Docker, Caddy
- **Frontend:** Next.js 16, React 19, framer-motion, zustand, Tailwind, `zcashname-sdk`, `qrcode`
- **Network:** lightwalletd at `testnet.zec.rocks:443`, Fauzec testnet faucet

## Design decisions

- **Local signing, not browser crypto.** There is no working in-browser SDK for NU7 testnet, so proving and signing run in a loopback Rust service. The browser holds only ciphertext and a session token.
- **Instant Sync never touches spending.** The server gets a viewing key only; balances it reports are display-only and reconciled against local sync, which wins on any mismatch.
- **Confirmation policy matched.** The wallet service uses 1 confirmation on testnet; Instant Sync passes `--min-confirmations 1` so both report the same spendable.
- **Fees are not hardcoded.** The wallet builds a proposal and uses the fee the Zcash client computes (ZIP 317).
- **Disclosure uses a dedicated account.** Exporting a viewing key for account 1 keeps the primary account private.

## Next 30 days

1. Instant Sync in a **Nitro Enclave** with attestation checked by the client; UFVK delivered over the attested channel instead of argv.
2. **IVK-only** Instant Sync mode (receive-only visibility).
3. **Nym** for lightwalletd traffic, closing the IP gap in the trust note.
4. Send and review inside the extension popup; move the vault to the wallet service so popup and tab share it.
5. Viewing-key export to a CSV an accountant can use.

## More detail

- [docs/wallet.md](./docs/wallet.md): seeds, vaults, sessions, backup limits
- [docs/shielded-payments.md](./docs/shielded-payments.md): quote, send, faucet, journal
- [docs/selective-disclosure.md](./docs/selective-disclosure.md): viewing keys and what they do not prove
- [docs/privacy-workspace.md](./docs/privacy-workspace.md): privacy review and route previews
- [instant-sync-server/README.md](./instant-sync-server/README.md) and [DEPLOY.md](./instant-sync-server/DEPLOY.md)
- [DEMO.md](./DEMO.md): 2-minute demo script
- [frontend/](./frontend/README.md), [backend/](./backend/README.md), [engine/](./engine/README.md)
