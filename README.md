# Wallet API

A small wallet service: users register, log in, deposit, withdraw, transfer money to each other and page through their transaction history.

Built with Node.js (plain JavaScript, CommonJS), Express 5, SQLite (better-sqlite3), Zod, JWT and bcrypt.

## How to run

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # starts on http://localhost:3000 with watch mode
npm start        # same, without watch mode
npm test         # runs the test suite against in-memory databases
```

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | `dev-secret` | Secret used to sign tokens. **Set this outside local development.** |
| `DB_PATH` | `wallet.db` | SQLite file; created with its schema on first start |

## Endpoints

All request and response bodies are JSON. Wallet routes need `Authorization: Bearer <token>`.

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/health` | | 200 `{ ok: true }` | |
| POST | `/auth/register` | `name`, `email`, `password` (8+ chars) | 201 `{ user, token }` | 400, 409 |
| POST | `/auth/login` | `email`, `password` | 200 `{ token }` | 400, 401, 429 |
| GET | `/auth/me` | | 200 `{ user }` | 401 |
| GET | `/wallet` | | 200 `{ balance, currency }` | 401 |
| POST | `/wallet/deposit` | `amount` | 200 `{ balance, currency, transaction }` | 400, 401 |
| POST | `/wallet/withdraw` | `amount` | 200 `{ balance, currency, transaction }` | 400, 401, 422 |
| POST | `/wallet/transfer` | `toEmail`, `amount`; optional `Idempotency-Key` header | 201 (200 on replay) | 400, 401, 404, 422 |
| GET | `/wallet/transactions?page=1&limit=10` | | 200 `{ data, pagination }` | 401 |

- `amount` is a number or string with at most 2 decimals, greater than 0 and at most 100000 (`25`, `"40.50"`).
- Money is always returned as a string with 2 decimals (`"40.50"`).
- `limit` is capped at 100. Invalid `page`/`limit` values fall back to `1`/`10`.

Every error has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Balance is too low" } }
```

Codes: `VALIDATION_ERROR` and `INVALID_JSON` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `INSUFFICIENT_FUNDS` (422), `TOO_MANY_REQUESTS` (429), `INTERNAL_ERROR` (500). Validation errors also list each bad field in `details.errors`.

### curl examples

```bash
# register (save the token)
curl -s -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ali","email":"ali@x.com","password":"password123"}'
TOKEN=<token from the response>

# deposit
curl -s -X POST localhost:3000/wallet/deposit -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"amount":"100.00"}'

# transfer (safe to retry with the same Idempotency-Key)
curl -s -X POST localhost:3000/wallet/transfer -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 7f1c2a' \
  -d '{"toEmail":"bea@x.com","amount":"40.50"}'

# history
curl -s "localhost:3000/wallet/transactions?page=1&limit=10" -H "Authorization: Bearer $TOKEN"
```

## Project layout

```
src/
  app.js               builds the Express app (takes db + secret, so tests inject an in-memory DB)
  server.js            only calls listen()
  errors.js            AppError + helpers
  validation.js        Zod schemas, parseAmount, toMajor
  middleware.js        requireAuth, rateLimit, 404 and error handlers
  db/database.js       opens SQLite, creates tables
  db/repository.js     every SQL query lives here
  services/auth.service.js
  services/wallet.service.js
test/wallet.test.js
```

Layers: routes → services (business rules) → repository (all SQL) → SQLite. Route handlers only validate input and shape the response.

## Schema

| Table | Columns | Constraints |
| --- | --- | --- |
| `users` | `id`, `name`, `email`, `password_hash`, `created_at` | `email UNIQUE` |
| `wallets` | `user_id`, `balance` | `balance INTEGER CHECK (balance >= 0)`, FK to users, one wallet per user |
| `transactions` | `id`, `seq`, `user_id`, `type`, `amount`, `balance_after`, `counterparty`, `created_at` | `type` in `DEPOSIT`/`WITHDRAWAL`/`TRANSFER_IN`/`TRANSFER_OUT`, `amount > 0`, index on `(user_id, seq DESC)` |
| `idempotency_keys` | `user_id`, `key`, `response`, `created_at` | primary key `(user_id, key)` |

`foreign_keys` is switched on (SQLite has it off by default) and the database runs in WAL mode.

## Decisions

- **Plain JavaScript.** I chose plain JavaScript to spend the time on correctness and tests. Zod validates every input at runtime, which covers the main benefit TypeScript would give at the API boundary.
- **SQLite with better-sqlite3.** No server to install, the database is one file, and the synchronous API makes transactions simple: a whole transaction runs without another request interleaving.
- **Money as INTEGER minor units.** 12.34 is stored as 1234. `parseAmount` converts from the string form, because `19.99 * 100` is `1998.9999999999998` in JavaScript. Money leaves the API as a `"0.00"` string via one function (`toMajor`).
- **Conditional debit.** `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?` checks and subtracts in one statement, so there is no gap between reading and writing the balance.
- **Transactions.** Every balance change and its history row commit together. A transfer's debit, credit and both history rows are one transaction; if anything throws, all of it rolls back.
- **CHECK constraint as a safety net.** Even a buggy code path can't save a negative balance; the database refuses it.
- **Idempotency key on transfers.** If a client retries after a dropped connection, the saved response is returned (status 200) instead of moving money again. The key lookup, the transfer and saving the key run in the same transaction. Only successful transfers are saved, so a retry after a failure (for example insufficient funds) is evaluated again.
- **Prepared statements with placeholders** for every query, so user input is never pasted into SQL.
- **Auth.** bcrypt (cost 10) for passwords, a 1-hour JWT holding only the user id (`sub`). The user id always comes from the verified token, never from the request body. Login returns the same 401 for an unknown email and a wrong password. Users leave the API through one function that drops `password_hash`.
- **Login rate limit.** 10 attempts per minute per IP, in memory, returns 429 with `Retry-After`.
- **History ordering** uses a `seq` column rather than `created_at`, because two transactions can share a millisecond.
- **Express 5** forwards errors thrown in async handlers to the error middleware, so no `asyncHandler` wrapper is needed. A 500 never exposes a stack trace to the client.

## Assumptions

- One currency (AED) and one wallet per user, created at registration.
- Single server instance (the rate limiter and SQLite file are local to it).
- API only, no frontend.
- Maximum single amount is 100000.00.
- Reusing an idempotency key with a different body returns the original response; keys are scoped per user.

## With more time

- TypeScript or JSDoc types.
- PostgreSQL with `SELECT ... FOR UPDATE` row locks, locking both wallets in a fixed order (by user id) so opposite transfers can't deadlock.
- A migrations tool instead of `CREATE TABLE IF NOT EXISTS`.
- Refresh tokens and logout/revocation.
- Rate limiting backed by Redis, and evicting old entries from the in-memory map.
- Rejecting a reused idempotency key when the request body differs, and expiring old keys.
- Constant-time login for unknown emails (compare against a dummy hash).
- OpenAPI docs, a Dockerfile, structured logging.
