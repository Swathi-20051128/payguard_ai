# Datasets

This folder contains the supplied synthetic PayGuard datasets, included
directly so the project is runnable without re-extracting anything. If
you regenerate them or bring your own, the same filenames are expected.

- `transactions_master.csv` — full synthetic transaction set (12,000 rows)
- `train.csv` / `validation.csv` / `test_heldout.csv` — a **random row
  split** (not chronological) of the master file: 8,400 / 1,800 / 1,800
  rows respectively (70/15/15), each ~10% suspicious, with zero
  transactionId overlap between splits (verified).
- `merchants.csv` — merchant category + city reference data
- `refunds.csv`, `chargebacks.csv`, `settlements.csv` — supporting
  collections for the optional refund/chargeback/settlement
  reconciliation module (not yet built — see roadmap)

**Schema note:** transaction rows use `country` + `city` for location, not
`latitude`/`longitude`. Location-anomaly scoring (Phase 4 rule, Phase 5
model feature) is based on city transitions rather than geodistance for
this reason.

**Label note:** `groundTruthRisk` is a **binary** label (0 = normal, 1 =
suspicious, ~9.8% positive rate) — not a continuous 0–100 score. Both it
and `fraudScenario` exist **only** for offline evaluation and are never
surfaced in the product UI or returned by any analyst-facing API.

## Known data characteristic: not every scenario has a recoverable signal

Direct inspection of this dataset (documented in `ml-service/training/`
and the Phase 5 delivery notes) found that 5 of the 8 labeled fraud
scenarios have strong, genuinely discriminative structure in the raw
fields — `CARD_TESTING`, `VELOCITY_ABUSE`, `DUPLICATE_PAYMENT`,
`REFUND_ABUSE`, `AMOUNT_ANOMALY`. The other 3 — `MERCHANT_SPIKE`,
`COORDINATED_ACTIVITY`, `LOCATION_ANOMALY` — show no meaningful
separation from normal transactions in *any* combination of fields
checked (hourly/daily merchant volume, device/IP/card sharing, city
change patterns). This isn't a modeling shortfall; it reflects how this
particular synthetic dataset was generated, and it's exactly the kind of
gap the spec's relationship-graph feature (Phase 8) is meant to help
with for coordinated activity in particular. The trained model's actual
per-scenario recall (see `ml-service/training/evaluate.py` output)
confirms this pattern precisely.
