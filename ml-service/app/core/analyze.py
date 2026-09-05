"""
Bridges the API layer (raw transaction + optional precomputed
context) to the model layer (a FEATURE_COLUMNS-shaped row).

Neutral defaults for missing context fields are deliberately chosen
to represent "nothing unusual on this signal" rather than inventing
either a false-positive or false-negative direction -- e.g. novelty
flags default to False (not "definitely novel"), counts default to 1
(just this transaction, not "many recent attempts"). This mirrors
the spec's failure-handling principle: missing data reduces
confidence, it doesn't manufacture an alert.
"""
from __future__ import annotations

import pandas as pd

from app.core.features import FEATURE_COLUMNS
from app.core.schemas import TransactionInput

_NEUTRAL_DEFAULTS = {
    "amountDeviationFromCustomerMean": 0.0,
    "transactionsIn5Minutes": 1.0,
    "transactionsIn1Hour": 1.0,
    "deviceTransactionCountLifetime": 1.0,
    "failedAttemptsIn1Hour": 0.0,
    "uniqueCardsPerDevice": 1.0,
    "uniqueCardsPerDeviceLifetime": 1.0,
    "uniqueCustomersPerDevice": 1.0,
    "merchantVolumeDeviation": 0.0,
    "customerAccountAge": 0.0,
    "refundRate": 0.0,
    "chargebackRate": 0.0,
    "isDuplicateOrder": 0.0,
    "locationChangedFromPrevious": 0.0,
    "deviceNovelty": 0.0,
    "ipNovelty": 0.0,
}


def build_feature_row(txn: TransactionInput):
    """
    Returns (feature_row, used_default_features). feature_row is a
    1-row DataFrame with exactly FEATURE_COLUMNS, ready to hand to
    the models. used_default_features is True if ANY contextual
    field had to fall back to a neutral default (context wasn't
    supplied, or was only partially supplied).

    Note: txn.chargebackFlag is accepted on the request (the Node
    rule engine uses it directly — see chargebackFlagRule in Phase 4)
    but is deliberately NOT fed into the ML feature row. In the
    supplied training data, chargebackFlag=1 co-occurs with a
    suspicious label 100% of the time — a near-perfect synthetic
    "tell" rather than a genuine behavioral pattern, that would let
    the model partially memorize labels instead of learning real
    signal. Only the customer's HISTORICAL chargeback rate
    (chargebackRate, computed from strictly-prior transactions) is
    used as a feature.
    """
    context = txn.context.model_dump() if txn.context else {}
    used_default = False

    values = {
        "amount": txn.amount,
        "refundToAmountRatio": min(txn.refundAmount / txn.amount, 5.0) if txn.amount > 0 else 0.0,
    }

    for field_name, default in _NEUTRAL_DEFAULTS.items():
        provided = context.get(field_name)
        if provided is None:
            values[field_name] = default
            used_default = True
        else:
            values[field_name] = float(provided)

    row = pd.DataFrame([[values[col] for col in FEATURE_COLUMNS]], columns=FEATURE_COLUMNS)
    return row, used_default
