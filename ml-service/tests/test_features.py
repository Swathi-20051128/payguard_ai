import pandas as pd
import pytest

from app.core.features import FEATURE_COLUMNS, engineer_features


def make_df(rows: list[dict]) -> pd.DataFrame:
    """Builds a minimal valid transaction DataFrame from partial row dicts."""
    defaults = {
        "transactionId": None,
        "orderId": None,
        "merchantId": "merchant_1",
        "customerId": "customer_1",
        "amount": 100.0,
        "currency": "INR",
        "status": "success",
        "paymentMethod": "card",
        "cardToken": "card_token_1",
        "deviceId": "device_1",
        "ipHash": "ip_hash_1",
        "country": "IN",
        "city": "Mumbai",
        "timestamp": "2026-01-01 00:00:00",
        "refundAmount": 0.0,
        "chargebackFlag": 0,
        "failureReason": None,
    }
    full_rows = []
    for i, r in enumerate(rows):
        row = {**defaults, **r}
        row.setdefault("transactionId", f"txn_{i}")
        row.setdefault("orderId", f"order_{i}")
        full_rows.append(row)
    df = pd.DataFrame(full_rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


class TestNoLeakage:
    """The most important property: a row's features must never
    depend on transactions that happen AFTER it in time."""

    def test_reordering_input_rows_does_not_change_output(self):
        df = make_df(
            [
                {"timestamp": "2026-01-01 00:00:00", "deviceId": "d1", "amount": 100},
                {"timestamp": "2026-01-01 00:02:00", "deviceId": "d1", "amount": 200},
                {"timestamp": "2026-01-01 00:04:00", "deviceId": "d1", "amount": 300},
            ]
        )
        shuffled = df.iloc[[2, 0, 1]].reset_index(drop=True)

        result_a = engineer_features(df).set_index("transactionId").sort_index()
        result_b = engineer_features(shuffled).set_index("transactionId").sort_index()

        pd.testing.assert_frame_equal(result_a[FEATURE_COLUMNS], result_b[FEATURE_COLUMNS])

    def test_a_transaction_is_unaffected_by_a_later_transaction_being_added(self):
        base = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "customerId": "c1", "amount": 100},
                {"transactionId": "t2", "timestamp": "2026-01-01 00:05:00", "customerId": "c1", "amount": 150},
            ]
        )
        with_future_row = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "customerId": "c1", "amount": 100},
                {"transactionId": "t2", "timestamp": "2026-01-01 00:05:00", "customerId": "c1", "amount": 150},
                # A much later, extreme transaction that should have
                # zero effect on t1's or t2's own feature values.
                {"transactionId": "t3", "timestamp": "2026-06-01 00:00:00", "customerId": "c1", "amount": 999999},
            ]
        )

        feat_base = engineer_features(base).set_index("transactionId")
        feat_with_future = engineer_features(with_future_row).set_index("transactionId")

        for txn_id in ["t1", "t2"]:
            pd.testing.assert_series_equal(
                feat_base.loc[txn_id, FEATURE_COLUMNS], feat_with_future.loc[txn_id, FEATURE_COLUMNS], check_names=False
            )


class TestDeviceVelocityFeatures:
    def test_counts_attempts_within_5_minute_window_inclusive_of_self(self):
        df = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "deviceId": "d1"},
                {"transactionId": "t2", "timestamp": "2026-01-01 00:03:00", "deviceId": "d1"},
                {"transactionId": "t3", "timestamp": "2026-01-01 00:04:00", "deviceId": "d1"},
                # Outside the 5-minute window relative to t4 (t1 is 10 min before)
                {"transactionId": "t4", "timestamp": "2026-01-01 00:10:00", "deviceId": "d1"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "transactionsIn5Minutes"] == 1
        assert result.loc["t3", "transactionsIn5Minutes"] == 3  # t1, t2, t3 all within 5 min of t3
        assert result.loc["t4", "transactionsIn5Minutes"] == 1  # nothing else nearby

    def test_different_devices_do_not_share_counts(self):
        df = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "deviceId": "d1"},
                {"transactionId": "t2", "timestamp": "2026-01-01 00:01:00", "deviceId": "d2"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "transactionsIn5Minutes"] == 1
        assert result.loc["t2", "transactionsIn5Minutes"] == 1

    def test_unique_cards_per_device_counts_distinct_tokens_in_window(self):
        df = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "deviceId": "d1", "cardToken": "c1"},
                {"transactionId": "t2", "timestamp": "2026-01-01 00:10:00", "deviceId": "d1", "cardToken": "c2"},
                {"transactionId": "t3", "timestamp": "2026-01-01 00:20:00", "deviceId": "d1", "cardToken": "c1"},  # repeat
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "uniqueCardsPerDevice"] == 1
        assert result.loc["t2", "uniqueCardsPerDevice"] == 2
        assert result.loc["t3", "uniqueCardsPerDevice"] == 2  # c1, c2 distinct — repeat doesn't add a 3rd

    def test_device_transaction_count_lifetime_is_a_running_total(self):
        df = make_df(
            [
                {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "deviceId": "d1"},
                {"transactionId": "t2", "timestamp": "2026-03-01 00:00:00", "deviceId": "d1"},  # far apart in time
                {"transactionId": "t3", "timestamp": "2026-06-01 00:00:00", "deviceId": "d1"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert list(result.loc[["t1", "t2", "t3"], "deviceTransactionCountLifetime"]) == [1, 2, 3]


class TestDuplicateOrderFlag:
    def test_first_occurrence_is_not_flagged(self):
        df = make_df([{"transactionId": "t1", "orderId": "order_x", "timestamp": "2026-01-01 00:00:00"}])
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "isDuplicateOrder"] == 0

    def test_second_occurrence_is_flagged_but_not_the_first(self):
        df = make_df(
            [
                {"transactionId": "t1", "orderId": "order_x", "timestamp": "2026-01-01 00:00:00"},
                {"transactionId": "t2", "orderId": "order_x", "timestamp": "2026-01-01 00:05:00"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "isDuplicateOrder"] == 0
        assert result.loc["t2", "isDuplicateOrder"] == 1


class TestRefundToAmountRatio:
    def test_no_refund_gives_zero(self):
        df = make_df([{"amount": 1000, "refundAmount": 0}])
        result = engineer_features(df)
        assert result["refundToAmountRatio"].iloc[0] == 0

    def test_full_refund_gives_ratio_one(self):
        df = make_df([{"amount": 1000, "refundAmount": 1000}])
        result = engineer_features(df)
        assert result["refundToAmountRatio"].iloc[0] == 1.0

    def test_ratio_is_capped_to_avoid_extreme_outliers(self):
        df = make_df([{"amount": 100, "refundAmount": 100000}])
        result = engineer_features(df)
        assert result["refundToAmountRatio"].iloc[0] == 5.0  # capped, not 1000


class TestNoveltyFeatures:
    def test_first_device_and_ip_use_are_novel(self):
        df = make_df([{"deviceId": "d1", "ipHash": "ip1"}])
        result = engineer_features(df)
        assert result["deviceNovelty"].iloc[0] == 1
        assert result["ipNovelty"].iloc[0] == 1

    def test_repeat_device_for_same_customer_is_not_novel(self):
        df = make_df(
            [
                {"transactionId": "t1", "customerId": "c1", "deviceId": "d1", "timestamp": "2026-01-01 00:00:00"},
                {"transactionId": "t2", "customerId": "c1", "deviceId": "d1", "timestamp": "2026-01-02 00:00:00"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t1", "deviceNovelty"] == 1
        assert result.loc["t2", "deviceNovelty"] == 0

    def test_same_device_for_a_different_customer_is_still_novel_for_them(self):
        df = make_df(
            [
                {"transactionId": "t1", "customerId": "c1", "deviceId": "d1", "timestamp": "2026-01-01 00:00:00"},
                {"transactionId": "t2", "customerId": "c2", "deviceId": "d1", "timestamp": "2026-01-02 00:00:00"},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t2", "deviceNovelty"] == 1


class TestAmountDeviation:
    def test_defaults_to_zero_with_fewer_than_3_prior_transactions(self):
        df = make_df(
            [
                {"transactionId": "t1", "customerId": "c1", "timestamp": "2026-01-01 00:00:00", "amount": 100},
                {"transactionId": "t2", "customerId": "c1", "timestamp": "2026-01-02 00:00:00", "amount": 100},
                {"transactionId": "t3", "customerId": "c1", "timestamp": "2026-01-03 00:00:00", "amount": 100000},
            ]
        )
        result = engineer_features(df).set_index("transactionId")
        # Only 2 prior transactions exist for t3 — below the trust threshold of 3.
        assert result.loc["t3", "amountDeviationFromCustomerMean"] == 0.0

    def test_fires_once_enough_history_exists(self):
        rows = [
            {"transactionId": f"t{i}", "customerId": "c1", "timestamp": f"2026-01-0{i+1} 00:00:00", "amount": amt}
            for i, amt in enumerate([90, 100, 110, 95])
        ]
        rows.append({"transactionId": "t5", "customerId": "c1", "timestamp": "2026-01-06 00:00:00", "amount": 10000})
        df = make_df(rows)
        result = engineer_features(df).set_index("transactionId")
        assert result.loc["t5", "amountDeviationFromCustomerMean"] > 0


def test_no_nan_values_in_any_feature_column():
    df = make_df(
        [
            {"transactionId": "t1", "timestamp": "2026-01-01 00:00:00", "customerId": "c1"},
            {"transactionId": "t2", "timestamp": "2026-01-02 00:00:00", "customerId": "c2", "refundAmount": 50, "amount": 100},
        ]
    )
    result = engineer_features(df)
    assert result[FEATURE_COLUMNS].isna().sum().sum() == 0


def test_returns_all_declared_feature_columns():
    df = make_df([{"timestamp": "2026-01-01 00:00:00"}])
    result = engineer_features(df)
    for col in FEATURE_COLUMNS:
        assert col in result.columns
