# Wallets

Three wallet implementations exist. Only the first one can hold testnet ZEC.

## 1. Wallet service and browser session

Code: `engine/services/wallet-service` and `frontend/src/features/session/`.

The service binds to loopback and accepts only `Origin: http://localhost:3000` or `Origin: http://127.0.0.1:3000`, and a `Host` of `localhost`, `127.0.0.1`, or `::1`.

### Create

`POST /api/wallet/wallets` with `{ "password" }` checks that the password is at least 8 characters, generates a 24-word phrase, and holds it in process memory for 10 minutes. The response includes the phrase. `POST /api/wallet/wallets/confirm` with `{ "createId" }` requires `LIGHTWALLETD_ENDPOINT`, creates ZIP 32 account 0, and returns:

- `walletId` (`w_` plus 32 hex characters)
- `kdfSalt`
- `ciphertext`
- `birthdayHeight`

The browser must store that record and then call `POST /api/wallet/wallets/ack` with the same `createId`. Ack returns `sessionToken` and drops the pending phrase. `POST /api/wallet/wallets/cancel` works only before confirm.

After 10 minutes, confirm returns an error and does not return the ciphertext again, even if the sqlite was already written. That error does not delete the pending phrase. A restart does. Ciphertext already stored in IndexedDB can still unlock that sqlite.

On disk, a new wallet is `WALLET_DATA_DIR/vaults/<walletId>/wallet.sqlite` and `birthday.txt`. There is no `recovery.txt` for this account. The phrase is not stored on the server after ack.

The browser record goes to IndexedDB database `emperor-wallet`, store `vaults`, key `walletId`. Fields are `walletId`, `kdfSalt`, `ciphertext`, `birthdayHeight`, and `sessionToken`.

Encryption is `Argon2::default()` from the `argon2` crate (Argon2id, that crate's default parameters) and ChaCha20-Poly1305. The associated data is `emperor-wallet-v1`. The record version must be 1. The password is not written down by the app.

### Unlock, lock, restart

`POST /api/wallet/session/unlock` sends `password`, `walletId`, `kdfSalt`, and `ciphertext`. The service decrypts the phrase, derives the seed with an empty BIP-39 passphrase, checks it against account 0 and account 1 if that account exists, loads the sqlite, and returns a new 32-byte hex bearer token.

Guarded routes require `Authorization: Bearer <token>`. Those routes are readiness, address, sync, quote, send, shield quote/send, faucet, disclosure, and transaction status. Session, create, and move routes do not require a bearer token. They still require the origin and host checks.

`POST /api/wallet/session/lock` clears the in-memory seed, open quotes, and any disclosure-export challenge. It does not delete the sqlite or the token map entry. The profile screen also clears tokens in IndexedDB. A bearer token copied earlier cannot call guarded routes while the seed is unloaded. After the next unlock, that old token works again, because it still names the same in-memory wallet. Restarting the process drops every token and every seed.

A token left in IndexedDB survives a browser restart. It does not survive a service restart. The next session check looks locked, and the user enters the password again. The ciphertext has to still be in IndexedDB.

`GET /api/wallet/session` without a valid token returns `locked: true`, `hasWallet: false`, and `hasPassword: false`. It does not list on-disk wallets. The gate lists wallets from this browser's IndexedDB. `legacyUnclaimed` is true when `recovery.txt` exists and `browser-wallet.json` does not.

### Move an older on-disk wallet

This is the only reader of `recovery.txt`.

`POST /api/wallet/wallets/claim` with `{ "password" }` reads `WALLET_DATA_DIR/recovery.txt`, checks it against the account in the root sqlite, and returns the phrase once. Confirm returns ciphertext and the account birthday already stored in that database. Ack writes `browser-wallet.json` with the wallet id, zero-fills and deletes `recovery.txt`, loads that same root sqlite, and returns a session token.

If confirm or the browser save fails before ack, `recovery.txt` is still there. If ack deletes the file and the browser has the ciphertext, later unlocks use the root directory because the claim marker matches the wallet id.

A phrase file with no account is refused. `WALLET_BIRTHDAY_HEIGHT` does not change this. Startup ignores that variable. `create_first_account` is not called.

`POST /api/wallet/session/password` can encrypt a loaded wallet's `recovery.txt` into `recovery.enc` and `session-password.json`, then delete `recovery.txt`. The UI does not call it. After that, `legacyUnclaimed` is false, and this UI has no way to open `recovery.enc`. New wallets never had `recovery.txt`, so this route does not protect them either.

### What you must keep

To spend after a restart you need all of:

- the same `WALLET_DATA_DIR` (the sqlite for that wallet id, or the root sqlite for a moved wallet)
- this browser's IndexedDB ciphertext for that wallet id
- the password

The written phrase is not enough. Nothing in the current UI or API imports a phrase into an existing account. Clearing site data for this origin deletes the ciphertext. The sqlite can remain and still be unusable here. Another browser has neither the ciphertext nor a way to import the phrase.

Cancel or leave before confirm if you do not want the account created. After confirm, the sqlite exists even if this browser never stored the ciphertext. The pending phrase is only in service memory, and a restart deletes it.

### What crosses the boundary

| Crosses to the browser | Stays on the service while unlocked | Does not leave the machine by itself |
|---|---|---|
| Phrase, once, on create or move | Seed in process memory | Sqlite notes and scan state |
| Password, salt, ciphertext, wallet id on unlock | Open quotes and the send journal | |
| Session token | | |
| Address, balances, quote fields, transaction ids | | |
| UFVK and UIVK, only after the disclosure reveal | Spending keys are derived for send and then used inside the process | |

Create and move responses contain a seed. Logs were not re-checked for accidental phrase output in this pass. Do not run those requests in a recorded terminal if the phrase must stay private.

Faucet claim bodies are `requestId` and an optional `captchaToken`. The service inserts its own receiving address (shielded `utest1…`). The funding panel does not send a captcha token. When the faucet reports a captcha, the panel opens the website instead.

### Transparent receive, send, and shield (testnet only)

With `transparent-inputs` enabled on the Zcash crates, the primary account registers a testnet transparent receiver (`tm…`).

- `GET /api/wallet/address` still returns the shielded UA as `address`. The same payload includes optional `transparentAddress` (`tm…`). That address is public on-chain.
- Readiness reports shielded balances separately from `transparentDetectedZatoshis` / `transparentSpendableZatoshis`. Overview labels them separately and does not fold transparent spendable into “shielded spendable ZEC.”
- Quote/send accept shielded (`utest1` / `ztestsapling`) or transparent (`tm` / `t2`) testnet recipients. A testnet service refuses mainnet `t1` / `t3` / `zs1` / `u1`; a mainnet service refuses testnet addresses. The UI stays shielded-first: transparent sends require turning off “shielded receiver required” on review before approve.
- `POST /api/wallet/shield/quote` and `POST /api/wallet/shield/send` use `propose_shielding` to move spendable transparent UTXOs into Orchard. Unshield is a normal send to the wallet’s own `tm…` with the same public-output warning. Disclosure UFVK export remains shielded-only.
- Each service instance is fixed to one network at startup (`WALLET_NETWORK`). The header toggle selects the testnet service (8787) or the mainnet service (8788). The mainnet path is implemented but untested with funds; it has no faucet and uses Zcash default confirmations (3 for own change, 10 for incoming).

## 2. Backup vault in localStorage

Code: `frontend/src/features/custody/` and `/settings/backup-wallet`.

This screen can create or import a 24-word phrase, confirm three words, and store AES-GCM ciphertext in `localStorage` under `emperor.wallet.vault.v1`. The key is PBKDF2-SHA-256 with 600,000 iterations. An extra BIP-39 passphrase is rejected. The unlocked phrase is a variable in the page's JavaScript heap. The screen's lock clears that variable. Refresh does not keep it. Removing the vault deletes the ciphertext and leaves a written copy alone.

The wallet service never sees this phrase. The screen does not derive a unified address and does not broadcast. It is reachable only when the app shell is showing page content: the live session is unlocked, or the wallet service is unreachable.

## 3. Unused demo adapter

`frontend/src/features/wallet/demo-wallet.ts` is not mounted. It is not a third funded account.

## Files that are secret

Under the data directory: `wallet.sqlite` (and its `-wal` / `-shm` files), `birthday.txt`, `send-journal.json`, `recovery.txt` until a move deletes it, `recovery.enc`, `session-password.json`, `browser-wallet.json`, and everything under `vaults/`.

`.gitignore` ignores directories named `wallet-data` and `wallet-data-*`, plus `recovery.txt`, `birthday.txt`, `wallet.sqlite`, and `send-journal.json` anywhere. It does not name `recovery.enc`, `session-password.json`, or `browser-wallet.json`. Point `WALLET_DATA_DIR` at a `wallet-data` directory so those files stay inside an ignored folder.
