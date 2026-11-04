# Frontend

Next.js app for Zeno Wallet. Setup, ports, and wallet behavior are in the [repository README](../README.md). This file only covers the UI package.

## Scripts

```bash
npm install
npm run dev    # http://localhost:3000
npm run lint
npm test       # vitest run
npm run build
npm start
```

Copy [.env.example](./.env.example) to `.env.local` before `dev` or `build`. Restart after changes. Do not commit `.env.local`.

## What the routes do

| Path | Behavior |
|---|---|
| `/` | Public landing page. It does not wait for the wallet service. |
| `/dashboard` | Spendable wallet balance, payment actions, route/disclosure entry points, and recent payment attempts. Simulation is labelled. |
| `/wallet` | Faucet funding panel for the unlocked testnet account. |
| `/pay/send`, `/pay/review`, `/pay/status` | Send flow. `NEXT_PUBLIC_WALLET_BACKEND=live` uses the wallet service. Otherwise send is simulated. `/pay` redirects to `/dashboard`. |
| `/pay/receive` | Shielded address from the wallet service. No fixture address. |
| `/pay/lab` | In-browser simulated timings. It does not call the payment engine. |
| `/swap` | 1Click mainnet dry quotes and privacy requirements. No swap execution. Uses a same-origin Next.js endpoint, not Nest. |
| `/settings/disclosure` | Viewing-key export for the wallet service. |
| `/audit` | Independent read-only testnet viewing-key scan; no spending session required. |
| `/settings/backup-wallet` | Separate localStorage seed vault. It cannot spend the testnet account. |
| `/activity` | Current-tab payment attempts and optional tracking-receipt recovery. |
| `/intelligence` | Placeholder. |

In live mode, while the wallet service is reachable and locked, the shell replaces wallet-page content with the create, unlock, or move gate. Simulated mode and route previews remain accessible. If the service is down, those pages render and live calls fail.

## Two wallets in this package

- `src/features/session/` is the live path. IndexedDB holds ciphertext and the bearer token. The seed is decrypted by the wallet service.
- `src/features/custody/` and `src/components/wallet/wallet-screen.tsx` are the backup vault, mounted only at `/settings/backup-wallet`.
- `src/features/wallet/demo-wallet.ts` and `src/features/routing/route-scorer.ts` are not used by a page.

Custody details: [docs/wallet.md](../docs/wallet.md).

## Checks in this tree

Run `npm test`, `npm run lint`, and `npx tsc --noEmit`. The new provider, guard, and recovery tests use mocks and do not move funds. See [Privacy workspace](../docs/privacy-workspace.md) for the feature boundaries and manual verification still needed.
