# Security Notes

PayGuard AI is a **defense-only, test-mode system**. It never
connects to real payment processing, real cards, or real bank
accounts, and never collects card numbers, CVVs, passwords, or
government ID data.

## Authentication & authorization
- Passwords hashed with bcrypt (12 salt rounds).
- JWT-based auth, 8h expiry by default (`JWT_EXPIRES_IN`).
- Public self-registration always creates a `viewer` -- there is no
  API path to self-escalate to `analyst`/`admin`. Only
  `npm run seed:users` (or a future admin-management UI) can create
  elevated accounts.
- Every mutating route checks role via `authorize(...)` middleware --
  verified with dedicated 403 tests per role, per route.

## Input validation
- Every request body/query is validated with Zod before touching the
  database.
- CSV/JSON upload: file size capped (`MAX_UPLOAD_SIZE_MB`), file type
  checked by extension and MIME type, `cardToken` fields rejected if
  they look like a real card number (`^\d{12,19}$`).
- Rate limiting: global (120 req/min by default) plus a stricter
  limit on auth routes (20 req/15min) to slow credential stuffing.

## Data handling
- No real card numbers, CVVs, or bank credentials are ever accepted,
  stored, or logged -- only synthetic identifiers
  (`card_token_xxx`, `device_xxx`, `ip_hash_xxx`).
- Structured logging (pino) redacts `Authorization` headers and any
  `password`/`cardToken`/`cardNumber`/`cvv` fields automatically.
- `.env` is git-ignored; `.env.example` documents required variables
  with no real secrets.

## Safe test-mode actions
Every action a case can trigger (Feature 10) is a simulation:
`request_verification`, `merchant_notification`, and `review_hold`
have no real-world side effect beyond a database record and an audit
log entry. `add_to_watchlist` creates a real internal Watchlist
record (used only within this system). None of them block a real
payment, contact a real customer, or touch any external API.

## Audit trail
Every mutating action (case creation, assignment, decisions, test-mode
actions, alert status changes) is recorded to an append-only audit
log, chained via SHA-256 (`currentHash = SHA256(previousHash +
eventData + timestamp)`). `GET /api/audit-logs/verify` (admin-only)
recomputes the whole chain and reports whether it's intact -- a
concrete, checkable tamper-evidence mechanism, not just a claim.

**Known limitation**: the audit log's sequence assignment (read-last,
increment, insert) is not wrapped in a database transaction, so two
truly simultaneous writes could in principle race. At this project's
scale that's an accepted, documented trade-off; a production
deployment would use a Mongo transaction or a dedicated atomic
counter. `verifyChain()` would still correctly detect any resulting
inconsistency.

## Never claims "fraud confirmed"
Every risk-level label, recommended action, and case decision uses
language like "requires investigation" or "requires verification or
escalation" -- never asserts fraud is proven. This is enforced by
naming convention throughout the codebase and spot-checked in tests
(`recommendedActionText`, `caseLogic.ts`).

## Known gaps for a real deployment (not addressed in this MVP)
- No refresh-token/session revocation (JWTs are stateless; logout is
  client-side only).
- No per-IP anomaly detection on the auth endpoints beyond rate
  limiting.
- The audit hash-chain concurrency caveat above.
- Docker images are dev-oriented (`npm run dev`, `--reload`), not
  hardened production builds.
