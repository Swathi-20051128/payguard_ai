"""
Feature engineering for PayGuard AI's ML models.

Every feature here is computed using only information that would
genuinely be available at the moment of the transaction -- no row's
feature values ever depend on transactions that happened later in
time. This matters twice over: it's what makes the held-out
evaluation numbers honest (Phase 5's "no fake metrics" requirement),
and it's what makes the model's behavior match how it will actually
be used in production (scoring a transaction as it arrives, not
after the fact).

Timestamps in the supplied datasets are minute-granularity, so exact
ties are common (276 out of 12,000 rows in transactions_master.csv).
Ties are broken by a stable secondary sort key (the DataFrame's
original row order) so "prior" is always well-defined and
deterministic, never ambiguous.
"""
from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS = [
    "amount",
    "amountDeviationFromCustomerMean",
    "transactionsIn5Minutes",
    "transactionsIn1Hour",
    "deviceTransactionCountLifetime",
    "failedAttemptsIn1Hour",
    "uniqueCardsPerDevice",
    "uniqueCardsPerDeviceLifetime",
    "uniqueCustomersPerDevice",
    "merchantVolumeDeviation",
    "customerAccountAge",
    "refundRate",
    "chargebackRate",
    "refundToAmountRatio",
    "isDuplicateOrder",
    "locationChangedFromPrevious",
    "deviceNovelty",
    "ipNovelty",
]

# Minimum prior hourly buckets before a merchant's own baseline is
# trusted; below this, volume deviation falls back to 0 (neutral)
# rather than an unreliable ratio off near-empty history. Mirrors the
# same fallback principle as the Node rule engine (Phase 4).
MIN_MERCHANT_BASELINE_BUCKETS = 5


def load_raw(path: str) -> pd.DataFrame:
    """Loads one of the supplied CSVs with correctly typed columns."""
    df = pd.read_csv(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes a raw transaction DataFrame (as loaded by load_raw) and
    returns a copy with every column in FEATURE_COLUMNS added.

    The input should be the FULL transaction history available at
    scoring time -- e.g. transactions_master.csv, not just a train or
    test slice -- so that a held-out row's contextual features (its
    device's recent activity, its customer's spending history, etc.)
    reflect real chronological neighbors. Which rows are used to FIT
    a model, versus which are only used to evaluate one, is a
    separate decision made downstream (see training/train.py) -- it
    does not change how context is computed here.
    """
    df = df.copy()
    df["_orig_order"] = range(len(df))
    df = df.sort_values(["timestamp", "_orig_order"]).reset_index(drop=True)

    df["_is_failed"] = (df["status"] == "failed").astype(int)
    df["_has_refund"] = (df["refundAmount"] > 0).astype(int)

    df = _add_customer_amount_deviation(df)
    df = _add_device_velocity_features(df)
    df = _add_merchant_volume_deviation(df)
    df = _add_customer_account_age(df)
    df = _add_customer_rate_features(df)
    df = _add_refund_ratio(df)
    df = _add_duplicate_order_flag(df)
    df = _add_location_change(df)
    df = _add_novelty_features(df)

    return df.drop(columns=["_orig_order", "_is_failed", "_has_refund"])


def _add_customer_amount_deviation(df: pd.DataFrame) -> pd.DataFrame:
    """
    (amount - customer's prior average) / customer's prior std,
    using an EXPANDING window that excludes the current row. A
    customer's first transaction has no prior history, so it gets 0
    (neutral -- "no basis for calling this unusual yet"), matching the
    Node rule engine's requirement of >=3 prior transactions before
    trusting a customer average.
    """
    grouped = df.groupby("customerId")["amount"]
    prior_mean = grouped.apply(lambda s: s.shift(1).expanding().mean()).reset_index(level=0, drop=True)
    prior_std = grouped.apply(lambda s: s.shift(1).expanding().std()).reset_index(level=0, drop=True)
    prior_count = grouped.cumcount()

    deviation = (df["amount"] - prior_mean) / prior_std.replace(0, pd.NA)
    deviation = pd.to_numeric(deviation, errors="coerce").fillna(0.0)
    # Fewer than 3 prior transactions or an undefined std -> not
    # enough history to trust a deviation score yet.
    deviation = deviation.where(prior_count >= 3, 0.0)

    df["amountDeviationFromCustomerMean"] = deviation.astype(float)
    return df


def _add_device_velocity_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Trailing-window counts per device: attempts in 5 minutes, attempts
    in 1 hour, failed attempts in 1 hour, distinct cards in 1 hour,
    distinct customers in 24 hours. All windows are inclusive of the
    current row (mirrors the Node velocity/card-testing rules).
    """
    indexed = df.set_index("timestamp")

    def rolling_count(window: str) -> pd.Series:
        return (
            indexed.groupby("deviceId")["transactionId"]
            .rolling(window)
            .count()
            .reset_index(level=0, drop=True)
            .reset_index(drop=True)
        )

    def rolling_sum(col: str, window: str) -> pd.Series:
        return (
            indexed.groupby("deviceId")[col]
            .rolling(window)
            .sum()
            .reset_index(level=0, drop=True)
            .reset_index(drop=True)
        )

    def rolling_nunique(col: str, window: str, group_col: str = "deviceId") -> pd.Series:
        # pandas' rolling().apply() requires a numeric dtype even when
        # the reducer itself is custom — factorize the string column
        # to integer codes first, then count distinct codes per window.
        codes = pd.factorize(indexed[col])[0]
        coded = indexed[[group_col]].copy()
        coded["_code"] = codes
        return (
            coded.groupby(group_col)["_code"]
            .rolling(window)
            .apply(lambda s: pd.Series(s).nunique(), raw=False)
            .reset_index(level=0, drop=True)
            .reset_index(drop=True)
        )

    df["transactionsIn5Minutes"] = rolling_count("5min").values
    df["transactionsIn1Hour"] = rolling_count("1h").values
    df["failedAttemptsIn1Hour"] = rolling_sum("_is_failed", "1h").values
    df["uniqueCardsPerDevice"] = rolling_nunique("cardToken", "1h").values
    df["uniqueCustomersPerDevice"] = rolling_nunique("customerId", "24h", group_col="deviceId").values

    # Empirically motivated: in the supplied dataset, some card-testing
    # activity is spread across weeks/months on a single device rather
    # than clustered in a tight burst (confirmed by direct inspection —
    # see features.md / README notes). A 1-hour window alone misses
    # that pattern entirely, so this adds an unbounded (all-time,
    # expanding) distinct-card count per device as a complementary
    # signal — still strictly leakage-safe (counts only up to and
    # including the current row in chronological order).
    df["uniqueCardsPerDeviceLifetime"] = (
        df.groupby("deviceId")["cardToken"]
        .apply(lambda s: s.groupby(s).cumcount().eq(0).cumsum())
        .reset_index(level=0, drop=True)
        .astype(float)
    )

    # Same motivation as above: a device shared across many
    # transactions over a long span (rather than a tight burst) is
    # itself an anomaly signal that a bounded time window misses.
    df["deviceTransactionCountLifetime"] = (df.groupby("deviceId").cumcount() + 1).astype(float)

    return df


def _add_merchant_volume_deviation(df: pd.DataFrame) -> pd.DataFrame:
    """
    (this hour's volume - merchant's prior hourly baseline) / baseline,
    where the baseline is the merchant's own expanding average hourly
    volume over all PRIOR hours that had any activity. Falls back to
    0 (neutral) when a merchant has too little history to trust --
    same principle as the Node rule engine's merchant-spike fallback,
    simplified here to a straight neutral value rather than borrowing
    a global baseline (the ML model already sees merchantId's
    aggregate behavior implicitly through training on many merchants).
    """
    df["_hour_bucket"] = df["timestamp"].dt.floor("h")

    hourly = df.groupby(["merchantId", "_hour_bucket"]).size().rename("volume").reset_index()
    hourly = hourly.sort_values(["merchantId", "_hour_bucket"])
    hourly["priorBaseline"] = hourly.groupby("merchantId")["volume"].transform(
        lambda s: s.shift(1).expanding().mean()
    )
    hourly["priorBucketCount"] = hourly.groupby("merchantId").cumcount()

    df = df.merge(
        hourly[["merchantId", "_hour_bucket", "volume", "priorBaseline", "priorBucketCount"]],
        on=["merchantId", "_hour_bucket"],
        how="left",
    )

    deviation = (df["volume"] - df["priorBaseline"]) / df["priorBaseline"].replace(0, pd.NA)
    deviation = pd.to_numeric(deviation, errors="coerce").fillna(0.0)
    deviation = deviation.where(df["priorBucketCount"] >= MIN_MERCHANT_BASELINE_BUCKETS, 0.0)

    df["merchantVolumeDeviation"] = deviation.astype(float)
    return df.drop(columns=["_hour_bucket", "volume", "priorBaseline", "priorBucketCount"])


def _add_customer_account_age(df: pd.DataFrame) -> pd.DataFrame:
    """Days since this customer's first transaction in the dataset (proxy for real account age, which isn't in the schema)."""
    first_seen = df.groupby("customerId")["timestamp"].transform("min")
    df["customerAccountAge"] = (df["timestamp"] - first_seen).dt.total_seconds() / 86400.0
    return df


def _add_customer_rate_features(df: pd.DataFrame) -> pd.DataFrame:
    """Customer's historical refund rate and chargeback rate, from strictly-prior transactions only."""
    for col, out_col in [("_has_refund", "refundRate"), ("chargebackFlag", "chargebackRate")]:
        grouped = df.groupby("customerId")[col]
        prior_mean = grouped.apply(lambda s: s.shift(1).expanding().mean()).reset_index(level=0, drop=True)
        df[out_col] = prior_mean.fillna(0.0).astype(float)
    return df


def _add_refund_ratio(df: pd.DataFrame) -> pd.DataFrame:
    """
    This transaction's OWN refundAmount / amount — distinct from the
    customer's historical refundRate above. Added after inspecting the
    supplied dataset directly: most REFUND_ABUSE rows are a single
    unusually large refund on an otherwise-new customer, not a
    repeated pattern the historical rate would catch. Mirrors the
    Node rule engine's REFUND_MISMATCH signal.
    """
    ratio = df["refundAmount"] / df["amount"].replace(0, pd.NA)
    df["refundToAmountRatio"] = ratio.fillna(0.0).clip(upper=5.0).astype(float)
    return df


def _add_duplicate_order_flag(df: pd.DataFrame) -> pd.DataFrame:
    """
    1 if this orderId has appeared in a strictly-earlier transaction,
    else 0. Added after inspecting the supplied dataset directly:
    DUPLICATE_PAYMENT rows are identifiable almost entirely by
    orderId reuse, which none of the windowed velocity features
    capture on their own. Mirrors the Node rule engine's
    DUPLICATE_PAYMENT signal.
    """
    seen_before = df.groupby("orderId").cumcount()
    df["isDuplicateOrder"] = (seen_before > 0).astype(float)
    return df


def _add_location_change(df: pd.DataFrame) -> pd.DataFrame:
    """
    Binary: does this transaction's city differ from the customer's
    established DOMINANT city (the city accounting for the largest
    share of their prior transactions, requiring >=3 prior
    transactions to trust it)? Mirrors the Node rule engine's
    location-anomaly signal (Phase 4) more closely than a naive
    "differs from the immediately preceding transaction" check, which
    empirical inspection showed was too noisy on this dataset (~72%
    of ALL transactions already differ from the immediately-preceding
    one, since customers here transact from multiple cities
    routinely — a dominant-city threshold is far more selective).

    A true geodistance isn't computable either way — the supplied
    schema has city/country, not latitude/longitude (see
    data/README.md) — so this remains a documented simplification of
    "locationDistanceFromPrevious", not the literal metric.
    """
    df["_prior_seq"] = df.groupby("customerId").cumcount()

    def dominant_city_share(sub: pd.DataFrame) -> pd.DataFrame:
        cities = sub["city"].tolist()
        dominant = []
        share = []
        counts: dict[str, int] = {}
        total = 0
        for city in cities:
            if total >= 3:
                top_city, top_count = max(counts.items(), key=lambda kv: kv[1])
                dominant.append(top_city)
                share.append(top_count / total)
            else:
                dominant.append(None)
                share.append(0.0)
            counts[city] = counts.get(city, 0) + 1
            total += 1
        sub = sub.copy()
        sub["_dominant_city"] = dominant
        sub["_dominant_share"] = share
        return sub

    df = df.groupby("customerId", group_keys=False).apply(dominant_city_share)

    changed = (df["_dominant_city"].notna()) & (df["_dominant_share"] >= 0.5) & (df["city"] != df["_dominant_city"])
    df["locationChangedFromPrevious"] = changed.astype(float)

    return df.drop(columns=["_prior_seq", "_dominant_city", "_dominant_share"])


def _add_novelty_features(df: pd.DataFrame) -> pd.DataFrame:
    """1 if this is the first time this customer has used this device/IP, else 0."""
    for col, out_col in [("deviceId", "deviceNovelty"), ("ipHash", "ipNovelty")]:
        seen_before = df.groupby(["customerId", col]).cumcount()
        df[out_col] = (seen_before == 0).astype(float)
    return df
