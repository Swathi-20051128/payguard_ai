# PayGuard AI — 5-Minute Demo Script

## Setup (before the demo)
```bash
cp .env.example .env
docker compose up --build
cd backend && npm run seed:users   # creates demo admin/analyst/viewer accounts
```
Open http://localhost:5173

## 1. Login (30s)
Log in as the seeded **analyst** account (`analyst@payguard.demo` /
`AnalystPass123!`, printed by `npm run seed:users`). Point out the
role badge in the top bar.

## 2. Generate data (30s)
Go to **Data** -> click **Generate sample data** (default 2,000
transactions). Point out: it's a real, seeded generator covering 10
distinct fraud scenarios, not a canned demo file. Risk analysis runs
automatically right after -- show the LOW/MEDIUM/HIGH/CRITICAL
breakdown and the "ML model available" indicator.

## 3. Dashboard (30s)
Go to **Dashboard**. Show the risk distribution chart and the
simulated exposure figure -- point out it's explicitly labeled
simulated, never presented as a real loss number.

## 4. Transaction explorer (30s)
Go to **Transactions**, filter by risk level = HIGH. Show a scored
transaction's risk score and confidence.

## 5. Alerts -> open a case (60s)
Go to **Alerts** (defaults to OPEN). Expand one alert to show the
**evidence** -- real, numbered reasons ("14 payment attempts from this
device in the last 5 minutes"), never a bare "flagged by AI". Click
**Open case**.

## 6. Investigate the case (90s)
Go to **Cases**, open the case you just created. Show:
- The evidence list (same reasons, in context)
- **Test-mode actions**: click "Place review hold" -- point out the
  response text explicitly says no real payment was blocked. Try
  "Add to watchlist" with a device ID.
- Record a **decision** (e.g. "Escalate") with a comment.

## 7. Audit trail (30s)
Go to **Audit**. Show the log entry for the case decision you just
made. As admin, click **Verify chain integrity** -- show it reports
valid, and explain: every entry is SHA-256-chained to the one before
it, so tampering with history would be detectable.

## 8. (Optional, if time) Real ML evaluation numbers
```bash
cd ml-service
python -m training.evaluate --data-dir ../data --model-dir ./models
```
Point out these are real numbers from a held-out test set -- not
hardcoded -- and that the per-scenario breakdown honestly shows which
fraud patterns the model catches well vs. poorly, with the "why" for
the weak ones documented in `data/README.md`.

## Talking points if asked
- **"Is this connected to real Razorpay?"** No -- entirely test-mode,
  synthetic data, no real payment processing anywhere in the stack.
- **"How do rules and ML combine?"** `combinedRiskScoring.ts`:
  60% rules (transparent, spec-mandated thresholds) + 40% ML
  (genuinely predictive but a black box), documented in code.
- **"What happens if the ML service goes down?"** The whole batch
  falls back to rules-only automatically, confidence drops to "low" --
  verified live during development by pointing the client at an
  unreachable port.
