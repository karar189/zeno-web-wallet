# Selective disclosure for the testnet wallet

Status: implemented in the wallet service. Testnet only. Not audited and not production-ready.

The unlocked wallet service can create a **dedicated ZIP 32 account** at index 1 and export only that account's unified viewing keys. The primary account at index 0 is not exported. This is **account-level viewing-key access**, not a per-transaction disclosure format. Export requires the bearer token from [wallet.md](./wallet.md). The seed stays available to the service, which can still spend both accounts.

Transaction-specific disclosure is **not implemented**. ZIP 311 is a Draft covering Sapling only, with Orchard marked TODO, and the pinned Zcash crates expose no ZIP 311 creation or verification API. The API and UI report that limitation explicitly instead of simulating a proof.

## Sources and pinned versions

Primary specifications:

- [ZIP 311: Zcash Payment Disclosures](https://zips.z.cash/zip-0311) — Status: Draft. Defines a disclosure containing the outgoing cipher key (`ock`) for an output. It contains `TODO: Add support for Orchard.` and `TODO: Decide on payment disclosure versioning.`
- [ZIP 310: Security Properties of Sapling Viewing Keys](https://zips.z.cash/zip-0310) — Status: Draft, Informational. Describes what a Sapling FVK guarantees, including spend detection through nullifiers, and marks memo-based sender identification as UNVERIFIED.
- [ZIP 316: Unified Addresses and Unified Viewing Keys](https://zips.z.cash/zip-0316) — Defines UFVK/UIVK and states that decrypting with the outgoing viewing key allows recovering the sent note plaintext, **including destination address, amount, and memo**.
- [ZIP 32: Shielded Hierarchical Deterministic Wallets](https://zips.z.cash/zip-0032) — Status: Final. An account is a “bucket of funds” under one spending authority, derived at `m/purpose'/coin_type'/account'` with hardened account derivation.
- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf) — Sapling FVK is `(ak, nk, ovk)`; Orchard FVK is `(ak, nk, rivk)`; IVK and OVK are derived from the FVK. See the sections on payment addresses and keys, note plaintexts, and decryption with incoming/outgoing viewing keys.
- [Orchard key design](https://zcash.github.io/orchard/design/keys.html) — Orchard `ovk` is derived from the `fvk`; users control whether the OVK is used.

Crate versions below are from `engine/services/wallet-service/Cargo.lock` on this tree. This pass confirmed the calls in `wallet.rs`. It did not re-read docs.rs and did not decrypt a note.

| Crate | Version | Call in this service |
| --- | --- | --- |
| `zcash_client_backend` | 0.25.0 | `WalletRead::get_unified_full_viewing_keys`, `WalletWrite::create_account`, `OvkPolicy::Sender` on send |
| `zcash_client_sqlite` | 0.23.0 | SQLite wallet database |
| `zcash_keys` | 0.17.0 | `UnifiedFullViewingKey`, `to_unified_incoming_viewing_key` |
| `zcash_address` | 0.14.0 | Testnet UFVK decode and item inspection before a key is returned |
| `zcash_primitives` | 0.31.0 | Wallet note stack |
| `zcash_proofs` | 0.31.0 | Bundled prover used by send |
| `orchard` | 0.16.0 | Transitive Orchard keys and notes |
| `sapling-crypto` | 0.9.0 | Transitive Sapling keys and notes |
| `zip32` | 0.3.0 | Account indices 0 and 1 |

`zcash_client_backend` and `zcash_client_sqlite` are pinned with `=` in [`Cargo.toml`](../engine/services/wallet-service/Cargo.toml). The other versions come from `Cargo.lock`.

## Findings

### 1. Viewing keys the wallet can derive

While a session is unlocked, the service holds that wallet's 24-word seed in memory. ZIP 32 derives a spending key, UFVK, UIVK, and addresses per account. `WalletWrite::create_account` derives the next contiguous account and returns `(AccountId, UnifiedSpendingKey)`; `WalletRead::get_unified_full_viewing_keys` returns the UFVK for each account. The UFVK can derive a UIVK with `UnifiedFullViewingKey::to_unified_incoming_viewing_key`.

The service never exports the seed, a unified spending key, or a Sapling/Orchard spending key. Its only disclosure export is the dedicated account's UFVK plus the derived UIVK. The returned spending key from account creation is dropped immediately and is never serialized into an HTTP response.

### 2. What an IVK reveals

An incoming viewing key can recognize and decrypt **incoming** notes for addresses derived from it, revealing the receiving address/diversifier, amount, memo, transaction id, and mined height. It cannot spend.

A UIVK contains **external-scope** keys only (ZIP 316 requires the UIVK descriptor to omit internal derivation). Therefore it does not see internal change, outgoing ciphertexts, or the account's nullifier key, so it cannot reliably report when a note is spent. Like any IVK, it can derive future external diversified addresses, so sharing it lets the holder link future payments to the same account.

### 3. What an FVK/UFVK reveals about incoming and outgoing activity

A UFVK contains full viewing keys for the account's shielded pools, including Orchard and Sapling keys where present. Sapling's FVK contains `ovk`; Orchard derives `ovk` from its FVK. With the account's OVK, a UFVK holder can decrypt outgoing ciphertexts created with that OVK, recovering the **destination address, amount, and memo** (ZIP 316). ZIP 310 also notes that an FVK provides the nullifier key, so the holder can detect when the account's notes are spent and in which transaction.

The UFVK also includes internal-scope keys, so it sees change outputs that a UIVK cannot. It does **not** include spending keys and cannot sign or spend.

Limits that remain even with a UFVK:

- A note does not contain the sender's shielded address. A memo may claim a sender, but ZIP 310 marks memo-based identification as UNVERIFIED.
- Outgoing decryption shows the destination and value, not who operated the wallet. It is not proof of real-world identity or transaction legitimacy.
- Outputs encrypted with a custom/foreign OVK, rather than the account's sender OVK, are not recoverable. This wallet's send path uses `OvkPolicy::Sender`, so its own outgoing notes use the sender account's OVK.
- ZIP 310 warns that a supplied Sapling FVK does not by itself let the recipient verify that the OVK is bound to the claimed address. The service creates the key from its own database, but the protocol does not turn that into third-party proof.

### 4. Sender, recipient, amount, and fees by transaction type

This wallet supports shielded Sapling/Orchard transfers. The disclosure account's address is derived with `UnifiedAddressRequest::SHIELDED`, which excludes transparent receivers. With `transparent-inputs` enabled for the primary account, exported disclosure UFVKs are reduced to Orchard/Sapling items before release so the auditor key stays shielded-only. The primary wallet can still receive/send transparent testnet funds separately; disclosure export does not.

| Question | Incoming shielded payment | Outgoing shielded payment |
| --- | --- | --- |
| Transaction id and height | Yes | Yes |
| Amount | Yes | Yes, from the outgoing ciphertext |
| Recipient address | Yes, the receiving address/diversifier | Yes, from the outgoing ciphertext |
| Memo | Yes | Yes, from the outgoing ciphertext |
| Actual sender address | No protocol field; a memo claim is unverified | The account is the sender; the operator and real-world identity are not proven |
| Change | Not applicable | Yes with a UFVK; not with a UIVK |
| Spend status | Yes with a UFVK (nullifier); not with a UIVK | Yes with a UFVK |
| Fee | Not a note field; not reported by this app | Not a note field; not reported by this app |
| Can it spend? | No | No |

A fee is not a field in the note plaintext or viewing key. A UFVK holder may be able to infer a fee when every input and output of a transaction is decryptable, but this service does not compute, display, or claim that inference.

### 5. Is ZIP 311 implemented for Sapling? Is Orchard transaction-specific disclosure available?

No for both.

ZIP 311 is Draft, uses the outgoing cipher key for the disclosed output, and only defines Sapling. Its Orchard work is a TODO. A source search of the pinned crates found no `PaymentDisclosure` type, creation API, verification API, or serialization format. `zcash_primitives` contains a 2020 changelog note that an outgoing cipher key “will eventually be used to implement Sapling payment disclosures”; that is a primitive, not an implementation of ZIP 311.

For Orchard, the pinned stack has no standardized transaction-specific disclosure format. The exported Orchard UFVK gives account-level incoming and outgoing visibility, but that is broader than one transaction and is **not** a payment disclosure. Implementing a custom disclosure format would be custom cryptography and is out of scope.

### 6. Can a dedicated account with its own viewing key be created?

Yes with the existing infrastructure. `WalletWrite::create_account` created ZIP 32 account 1 from the existing seed, with a birthday at the current chain tip/tree state. It has a different spending key, UFVK, UIVK, and shielded address from account 0.

The service still holds the seed, so it can derive the spending key for both accounts. “Cannot spend” describes the exported viewing key, not the service's custody. The auditor cannot derive the primary account's key from account 1's UFVK because ZIP 32 account derivation is hardened, but this is not a guarantee against someone who has the seed or both accounts' keys. Moving funds between the accounts can also create on-chain correlations (timing, amounts, and change patterns), even though a shielded incoming note does not reveal its sender address.

### 7. Can a shared viewing key be revoked?

No. There is no viewing-key revocation in the protocol or this service. A shared key is a bearer capability: deleting the UI state, deleting the account, or rotating to a new account does not invalidate copies that already left the device. A new account can isolate **future** funds, but it does not retract the old account's history or stop old copies from decrypting it. The only complete remedy is not to share the key, or to treat the disclosure account as permanently public.

## Options considered

| Option | Result |
| --- | --- |
| **A. Dedicated disclosure account (chosen)** | A second ZIP 32 account has its own viewing and spending authority. Exporting its UFVK/UIVK does not disclose account 0, but it does disclose all activity on account 1 and cannot be revoked. Fits the existing `create_account` API with no new cryptography. |
| **B. Export the primary account's viewing key** | Rejected. It would expose the primary account's incoming and outgoing history, change, and addresses. There is no isolation benefit. |
| **C. Transaction-specific disclosure** | Not available. ZIP 311 is Draft and Sapling-only; Orchard has no standardized implementation in the pinned stack. Building a custom format would violate the no-custom-cryptography constraint. |

Option A is the smallest safe working MVP: real account isolation at the ZIP 32 level, explicit approval, a one-time export, and honest reporting of the remaining account-level scope.

## Implemented behavior

### API

Disclosure routes use the loopback `Host` check, the `Origin` allowlist (`http://localhost:3000`, `http://127.0.0.1:3000`), and `Authorization: Bearer` for an unlocked session. Missing or unknown tokens get HTTP 401. They reject seed or spending-key fields in request bodies and return `Cache-Control: no-store` and `Pragma: no-cache`.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/wallet/disclosure` | none | Account status only; never key material |
| POST | `/api/wallet/disclosure/account` | `{ "approved": true }` | Creates account index 1 if needed; returns status, not a key |
| POST | `/api/wallet/disclosure/export/request` | `{ "approved": true }` | Returns a single-use `exportId` and expiry; no key |
| POST | `/api/wallet/disclosure/export` | `{ "exportId": "...", "approved": true }` | Returns the UFVK and derived UIVK once |

The export is two-step:

1. The request creates an `export_<uuid>` challenge with a two-minute lifetime and returns no key.
2. The reveal consumes the challenge, re-reads the disclosure account's UFVK from SQLite, encodes it for testnet, validates it, derives the UIVK, and returns both. A missing, expired, or already-used challenge is refused. A wrong challenge id does not consume the pending challenge.

Export validation requires:

- the encoded key decodes as a testnet `Ufvk`;
- at least one item is present;
- every item is Orchard or Sapling (no transparent or unknown items);
- the encoded key is not identical to the primary account's UFVK.

The response includes `scope.canSpend: false`, `scope.seesPrimaryAccount: false`, and `scope.provesSenderIdentity: false`. It never includes a seed, spending key, or recovery phrase.

Account creation requires the local seed and `LIGHTWALLETD_ENDPOINT`. It obtains a birthday from the current tree state, creates the account at index 1, verifies the returned account is index 1 and differs from the primary account, verifies the seed against the new account, and drops the returned unified spending key. Startup accepts only accounts at indices 0 and 1, rejects imported accounts, and refuses a disclosure account without a primary account.

### Unsupported capability reporting

Both the status and export responses include:

```json
{
  "transactionDisclosure": {
    "implemented": false,
    "saplingZip311": false,
    "orchard": false
  }
}
```

The UI renders a **Transaction-specific disclosure — not implemented** card with the ZIP 311 Draft/Sapling-only and Orchard limitations. It does not create or claim a per-transaction proof.

### Frontend

`/settings/disclosure` renders the **Auditor view** panel. `/wallet` is the funding panel, not this export. The panel:

- warnings for account-level scope, no spending, primary-account privacy, no sender proof, and irreversible sharing;
- explicit checkboxes and disabled actions until the user acknowledges the warning;
- account address, index, birthday, sync state, detected and service-spendable balances;
- one-time export request, reveal, copy, and “hide and discard from this page”;
- no `localStorage` or `sessionStorage` use for keys; the revealed key exists only in React state;
- service-spend warning because the seed remains in the wallet service.

## Verification

The documentation pass on 2026-10-31 did not run `cargo test`, `npm test`, or a live export. The counts below are source inventory, not passing results.

Source inventory now:

- Wallet-service Rust tests: 15 functions, including disclosure status, single-use export, origin and secret rejection, and account creation without a lightwalletd endpoint.
- Frontend disclosure tests: 5 `it` cases in `frontend/src/features/disclosure/disclosure.spec.ts`. The frontend suite overall has 56 `it` cases. `node_modules` was not installed here.
- Crate pins moved after the 2026-10-26 note. That note said `zcash_client_backend` 0.24.0 and 14 Rust tests. The lockfile is now 0.25.0, and the service requires a bearer token.

What the disclosure tests are written to cover:

- status is scoped to account 1 and contains no UFVK, UIVK, seed, or transaction-disclosure implementation claim;
- export requests require `approved: true`, return no key, and reveal once only;
- the exported UFVK decodes as testnet, contains only Orchard/Sapling items, equals account 1's UFVK, differs from account 0's, and both exported keys round-trip;
- the imported UIVK recognizes the published diversified disclosure address;
- untrusted origins, secret-bearing bodies, wrong export ids, expired/reused ids, and unapproved requests are refused;
- account creation requires approval and reports a missing lightwalletd endpoint without inventing an account.

Prior browser note, 2026-10-26, not repeated and not a result for the current session code or crate pins:

- A fresh testnet service on `127.0.0.1:8787` created account 0 at birthday 4,542,139 and account 1 at birthday 4,542,142 with a different shielded address.
- One reveal returned a `uviewtest1…` UFVK and a `uivktest1…` UIVK. After reload, the note says those strings were absent from the page, `localStorage`, and `sessionStorage`, and from the service log.
- The disclosure account had no funds. No transaction was decrypted with the exported key. That run did not prove auditor visibility of a real note.

## Manual test

No funds are required for the account and export flow. Use a testnet data directory you are willing to create accounts in. The requests below return key material. This documentation pass did not run them.

Unlock a wallet first and pass its session token. Without `Authorization: Bearer`, these routes return HTTP 401. Create and unlock are documented in [wallet.md](./wallet.md). Do not paste a real token into a recorded shell if you can avoid it.

```bash
cd engine/services/wallet-service
WALLET_NETWORK=testnet \
WALLET_API_BIND=127.0.0.1:8787 \
WALLET_DATA_DIR=/tmp/emperor-disclosure-manual \
LIGHTWALLETD_ENDPOINT=https://testnet.zec.rocks:443 \
cargo run --release
```

In another terminal:

```bash
# Status: no key material. Replace the token. Do not commit it.
curl -s http://127.0.0.1:8787/api/wallet/disclosure \
  -H 'Origin: http://localhost:3000' \
  -H 'Authorization: Bearer YOUR_SESSION_TOKEN'

# Create the dedicated index-1 account
curl -s -X POST http://127.0.0.1:8787/api/wallet/disclosure/account \
  -H 'Origin: http://localhost:3000' \
  -H 'Authorization: Bearer YOUR_SESSION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"approved":true}'

# Request a one-time export (response has exportId, no key)
curl -s -X POST http://127.0.0.1:8787/api/wallet/disclosure/export/request \
  -H 'Origin: http://localhost:3000' \
  -H 'Authorization: Bearer YOUR_SESSION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"approved":true}'

# Reveal within two minutes using the exportId from the previous response
curl -s -X POST http://127.0.0.1:8787/api/wallet/disclosure/export \
  -H 'Origin: http://localhost:3000' \
  -H 'Authorization: Bearer YOUR_SESSION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"exportId":"export_REPLACE_ME","approved":true}'
```

Expect a `uviewtest1…` UFVK and a `uivktest1…` UIVK. Repeating the reveal with the same id must fail. Without `approved: true`, expect `403`. With a missing/untrusted `Origin`, expect `403`.

To exercise the UI, unlock at <http://localhost:3000> with `NEXT_PUBLIC_WALLET_BACKEND=live` and `NEXT_PUBLIC_WALLET_URL=http://127.0.0.1:8787`, then open `/settings/disclosure`. After revealing, check DevTools. The viewing key should be absent from Local Storage, Session Storage, and the IndexedDB `emperor-wallet` record. That record does hold the wallet ciphertext and the session token. The sound preference and faucet claim record may also be in Local Storage.

A real visibility test still needs funding: send testnet TAZ only to the disclosure account's separate `utest1…` address, wait for confirmation, then import the exported UFVK into a watch-only testnet wallet and compare what it sees for that account. Do not reuse the primary account's address or funds.

## Not claimed

- No ZIP 311 payment disclosure, for Sapling or Orchard.
- No Orchard transaction-specific disclosure format.
- No viewing-key revocation, rotation, or access expiry after export. The two-minute challenge only limits how long the reveal window stays open; it does not expire the key.
- No proof of a sender's real-world identity, transaction legitimacy, or off-chain payment.
- No visibility test against a funded disclosure account or a real decrypted note.
- No verified mainnet disclosure. The mainnet service exists but has not been run with a funded wallet.
- No change to the payment engine's seed rejection or broadcast restrictions.
- The service is not production-ready. It binds to loopback, and its bearer token is not a remote login. Lock does not revoke copied tokens until the process exits. See [wallet.md](./wallet.md).


## Read-only scanner

The app now has an independent auditor workspace at `/audit`. It imports a testnet full viewing key as a ViewOnly account in a separate in-memory database; it does not open the spending wallet. See [Privacy workspace](./privacy-workspace.md#independent-auditor-scanner) for consent, data handling, the 2,000-block scan limit, and verification limitations. Exporting remains account-level visibility, not transaction-specific disclosure.
