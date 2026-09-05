# PayGuard AI — API Reference

Base URL: `http://localhost:4000/api` (backend). All routes except
`/health` and `/auth/register` / `/auth/login` require
`Authorization: Bearer <JWT>`.

## Auth
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | always creates a `viewer` |
| POST | `/auth/login` | public | returns `{ token, user }` |
| GET | `/auth/me` | any | current user |
| POST | `/auth/logout` | any | stateless, clears client token |

## Transactions
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/transactions/upload` | admin, analyst | multipart `file` (.csv/.json) |
| POST | `/transactions/generate-sample` | admin, analyst | body: `{ transactionCount, suspiciousRate, ... }` |
| GET | `/transactions` | any | paginated, filters: `merchantId, customerId, deviceId, status, riskLevel, from, to` |
| GET | `/transactions/uploads` | any | upload history |
| GET | `/transactions/:transactionId` | any | single transaction |

## Risk
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/risk/analyze-transaction` | admin, analyst | body: `{ transactionId }` |
| POST | `/risk/analyze-batch` | admin, analyst | body: one of `{ uploadId }`, `{ transactionIds: [] }`, `{ reanalyzeAll: true }` |
| GET | `/risk/summary` | any | aggregate risk-level counts, simulated exposure, ML coverage |

## Alerts
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/alerts` | any | paginated, filters: `status, severity, merchantId` |
| GET | `/alerts/:alertId` | any | single alert |
| PATCH | `/alerts/:alertId/status` | admin, analyst | body: `{ status, reason? }` |

## Cases
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/cases` | admin, analyst | body: `{ alertIds: [] }` |
| GET | `/cases` | any | paginated, filters: `status, assignedTo, merchantId` |
| GET | `/cases/:caseId` | any | populated with alerts + assignee |
| PATCH | `/cases/:caseId/assign` | admin, analyst | body: `{ assignedTo }` (a user id) |
| PATCH | `/cases/:caseId/decision` | admin, analyst | body: `{ decision, comment? }` — decision is one of confirmed_suspicious / dismissed / escalated |
| POST | `/cases/:caseId/actions` | admin, analyst | body: `{ actionType, reason?, watchlist? }` — see below |

### Case action types (all simulated — Feature 10 of the spec)
- `request_verification` — no real customer is contacted
- `add_to_watchlist` — requires `watchlist: { entityType, entityValue }`; creates a real Watchlist DB entry
- `generate_report` — returns a JSON case summary
- `merchant_notification` — no real notification is sent
- `review_hold` — sets `reviewHoldActive: true` on the case; does not block any real payment

## Audit
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/audit-logs` | any | admin/analyst see full detail; viewer gets a limited view (no state/reason/metadata) |
| GET | `/audit-logs/verify` | admin | recomputes the SHA-256 hash chain and reports whether it's intact |

## ML service (Python, port 8001 — called by the backend, not the frontend directly)
| Method | Path | Notes |
|---|---|---|
| GET | `/ml/health` | reports whether a trained model is loaded |
| POST | `/ml/analyze/transaction` | single-transaction scoring |
| POST | `/ml/analyze/batch` | batch scoring, one HTTP call for many transactions |
| POST | `/ml/evaluate` | real precision/recall/F1/PR-AUC/confusion-matrix against a labeled split |
