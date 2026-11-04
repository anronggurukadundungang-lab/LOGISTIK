# AGENTS.md

Companion app for SIMDONDAR: monitors stock per department. UI, API errors, and domain terms are Indonesian. Keep user-facing strings in Indonesian.

## Commands (run from repo root)

```bash
npm install
copy .env.example .env   # Windows; cp on Linux/macOS
npm run dev              # API :3000 + Vite :5173
npm run typecheck        # server then client
npm test                 # backend integration suite only
npm run build            # builds client to client/dist
```

- Single test: `npm --workspace server run test -- tests/app.test.ts -t "menyajikan health check"`
- Server dev: `npm run dev:server`; client dev: `npm run dev:client`
- Production: `npm run build`, set `NODE_ENV=production` and a `SESSION_SECRET` of 32+ chars, then `npm start` (single port 3000, serves `client/dist` if present).
- `npm run migrate` / `npm run seed` exist but are normally unnecessary: migrations run automatically on first `getDb()`/startup, and `seedBase()` is idempotent on every bootstrap.
- No lint, formatter, or CI config exists. Do not invent lint commands; verify with `typecheck` and `test`.
- Requires Node >=24: the database uses the built-in `node:sqlite` module.

## Architecture

- npm workspaces: `server` (Express 5 + TypeScript executed directly by `tsx`) and `client` (React 19 + Vite 8 + Tailwind 4).
- Server entrypoint: `server/src/server.ts` -> `createApp()`/`bootstrap()` in `server/src/app.ts`. Routes are mounted under `/api`; domain logic lives in `server/src/services/`.
- Server imports must keep explicit `.ts` extensions (`allowImportingTsExtensions`); there is no server build step.
- `client/vite.config.ts` proxies `/api` to `localhost:3000` in dev. In production the server serves the built SPA.
- Use `client/src/lib/api.ts` for all HTTP calls: it attaches credentials and the CSRF header, and handles 401 session expiry.
- SIMDONDAR PDF import is positional text extraction in `server/src/services/import.ts` (no OCR). It intentionally omits the PDF `Harga @ (Rp.)` and `Total (Rp.)` columns. Keep `server/tests/import-pdf.test.ts` and its PDF fixture passing when changing that parser.
- Import auto-create: `POST /api/imports/:id/validate` accepts `autoCreate`; unknown items/departments are inserted during validation (not commit), gated per type by `items.manage` / `departments.manage` permission, and audited as `AUTO_CREATE_ITEM`/`AUTO_CREATE_DEPARTMENT`. Flag is stored in `simdondar_import_batches.auto_create` (migration `002`).

## Database and domain rules

- SQLite DB path is resolved relative to `server/`, not the repo root (`DATABASE_PATH` default `../data/stok.db`). `.env` is loaded from repo root first, then `server/.env`.
- Migrations run automatically on first `getDb()` and on server startup. Add a new numbered `.sql` file to `server/src/migrations/`; the runner sorts filenames and records them in `schema_migrations`. Never edit an already-applied migration.
- `seedBase()` runs on every bootstrap and is idempotent; it creates the admin user only when the `users` table is empty.
- Stock is an append-only ledger (`stock_entries`). `department_stock_balances` is only a cache. Use `postEntryTx`/`withTx` from `server/src/services/stock.ts` inside a transaction; never update balances directly.
- Approval-gated flows (opname, adjustments, damage/loss, corrections) go through `approval_requests`; balances must not change until approval. Users cannot approve their own requests.
- Mutations should write an audit row (`writeAudit`) and notify relevant users (`notify`). Tests assert audit behavior.

## Security and testing quirks

- All non-GET `/api` calls made by an authenticated user require `X-CSRF-Token`, which is returned in the login payload (not a cookie).
- Authorization is enforced server-side with `requirePermission`/`requireAnyPermission` and `assertDepartmentAccess`. Client-side `Guard` in `App.tsx` is presentation only; always enforce scope in the route/service too.
- Backend tests use an in-memory DB and set `DATABASE_PATH=:memory:` before dynamically importing `src/app.ts`; keep that import order when adding test setup.
- Timestamps are stored as ISO-8601 UTC; business dates as `YYYY-MM-DD`; app timezone defaults to `Asia/Jakarta`.

## References

`README.md` (setup/features), `docs/ANALYSIS.md` (domain design and assumptions), `docs/INSTALL.md`, `docs/USER_GUIDE.md`, `docs/BACKUP_RESTORE.md`.
