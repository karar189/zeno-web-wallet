# Backend API

NestJS process for swap quotes and privacy reports. It does not hold seeds, sessions, or Zcash notes. The wallet service is separate. See the [repository README](../README.md).

## Run

```bash
cp .env.example .env   # optional; the same defaults exist in code
npm install
npm run start:dev
```

| Variable | Default | Use |
|---|---|---|
| `PORT` | `4000` | Listen port, all interfaces Nest binds by default |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Single CORS origin |

`GET /api/health` returns `status: ok`. `GET /api` returns the API name and version.

## Routes

Global prefix: `/api`.

| Method | Path | Result today |
|---|---|---|
| `GET` | `/api` | Name, version, pointer at the repo docs |
| `GET` | `/api/health` | `{ status: "ok", service: "zeno-api" }` |
| `POST` | `/api/quotes` | `dataSource: "mock"`, `quotes: []`, and a limitation string. The mock provider returns no routes. |
| `POST` | `/api/analyze` | Empty `findings`, `coverage: "partial"`, and a limitation string. |

Quote body fields are `inputAsset`, `outputAsset`, `amount`, `destinationChain`, and `mode` (`demo` or `live`). Extra fields are rejected. There is no `GET /api/status`. `RouteScorerService.scoreRouteIds` returns an empty list and has no controller.

The frontend Swap page is the only caller. A browser opened at `http://127.0.0.1:3000` does not match the default CORS origin.

## Tests

`npm test` runs one unit test: the root controller's name is `Zeno Wallet API`.

`npm run test:e2e` expects `GET /` to return the text `Hello World!`. The running app does not do that. Treat the e2e test as stale. This documentation pass did not run either command. `node_modules` was not installed.
