from pathlib import Path

from fastapi.testclient import TestClient

from app import model_state
from app.main import app

DATA_DIR = str(Path(__file__).resolve().parent.parent.parent / "data")


def test_analyze_transaction_with_full_context_reports_high_confidence():
    with TestClient(app) as client:
        resp = client.post(
            "/ml/analyze/transaction",
            json={
                "transactionId": "txn_test_1",
                "amount": 500,
                "refundAmount": 0,
                "chargebackFlag": False,
                "context": {
                    "amountDeviationFromCustomerMean": 0.5,
                    "transactionsIn5Minutes": 1,
                    "transactionsIn1Hour": 1,
                    "deviceTransactionCountLifetime": 3,
                    "failedAttemptsIn1Hour": 0,
                    "uniqueCardsPerDevice": 1,
                    "uniqueCardsPerDeviceLifetime": 1,
                    "uniqueCustomersPerDevice": 1,
                    "merchantVolumeDeviation": 0,
                    "customerAccountAge": 30,
                    "refundRate": 0,
                    "chargebackRate": 0,
                    "isDuplicateOrder": False,
                    "locationChangedFromPrevious": False,
                    "deviceNovelty": False,
                    "ipNovelty": False,
                },
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["transactionId"] == "txn_test_1"
    assert 0 <= body["anomalyScore"] <= 100
    assert 0 <= body["supervisedProbability"] <= 100
    assert body["usedDefaultFeatures"] is False
    assert body["confidence"] == "high"
    assert len(body["topContributingFeatures"]) == 3
    assert body["latencyMs"] >= 0


def test_analyze_transaction_without_context_reports_reduced_confidence():
    with TestClient(app) as client:
        resp = client.post(
            "/ml/analyze/transaction",
            json={"transactionId": "txn_test_2", "amount": 500},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["usedDefaultFeatures"] is True
    assert body["confidence"] == "reduced"


def test_analyze_transaction_with_partial_context_is_still_reduced_confidence():
    with TestClient(app) as client:
        resp = client.post(
            "/ml/analyze/transaction",
            json={
                "transactionId": "txn_test_3",
                "amount": 500,
                "context": {"transactionsIn5Minutes": 15},  # only one field supplied
            },
        )
    body = resp.json()
    assert body["usedDefaultFeatures"] is True


def test_analyze_transaction_flags_a_clearly_suspicious_pattern_as_higher_risk():
    """A velocity-abuse-shaped transaction (many recent attempts, many
    distinct cards, brand-new device) should score meaningfully higher
    than an ordinary one -- a coarse sanity check on the real model's
    directional behavior, not an exact-value assertion."""
    with TestClient(app) as client:
        normal = client.post(
            "/ml/analyze/transaction",
            json={
                "transactionId": "txn_normal",
                "amount": 500,
                "context": {
                    "transactionsIn5Minutes": 1,
                    "transactionsIn1Hour": 1,
                    "uniqueCardsPerDevice": 1,
                    "uniqueCardsPerDeviceLifetime": 1,
                    "deviceTransactionCountLifetime": 5,
                },
            },
        ).json()

        suspicious = client.post(
            "/ml/analyze/transaction",
            json={
                "transactionId": "txn_suspicious",
                "amount": 500,
                "context": {
                    "transactionsIn5Minutes": 15,
                    "transactionsIn1Hour": 15,
                    "uniqueCardsPerDevice": 9,
                    "uniqueCardsPerDeviceLifetime": 40,
                    "deviceTransactionCountLifetime": 90,
                },
            },
        ).json()

    assert suspicious["supervisedProbability"] > normal["supervisedProbability"]


def test_analyze_batch_scores_multiple_transactions():
    with TestClient(app) as client:
        resp = client.post(
            "/ml/analyze/batch",
            json={
                "transactions": [
                    {"transactionId": "b1", "amount": 100},
                    {"transactionId": "b2", "amount": 200},
                    {"transactionId": "b3", "amount": 300},
                ]
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["totalProcessed"] == 3
    assert len(body["results"]) == 3
    assert {r["transactionId"] for r in body["results"]} == {"b1", "b2", "b3"}
    assert body["averageLatencyMs"] >= 0
    assert body["throughputPerSecond"] >= 0


def test_analyze_batch_with_empty_list():
    with TestClient(app) as client:
        resp = client.post("/ml/analyze/batch", json={"transactions": []})
    assert resp.status_code == 200
    assert resp.json()["totalProcessed"] == 0


def test_evaluate_returns_real_metrics_on_test_heldout():
    with TestClient(app) as client:
        resp = client.post(
            "/ml/evaluate",
            json={"dataDir": DATA_DIR, "split": "test_heldout", "decisionThreshold": 0.5},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["rowCount"] == 1800
    assert 0 <= body["precision"] <= 1
    assert 0 <= body["recall"] <= 1
    assert 0 <= body["f1"] <= 1
    assert 0 <= body["prAuc"] <= 1
    assert "REFUND_ABUSE" in body["byScenario"]
    assert set(body["confusionMatrix"].keys()) == {
        "truePositive",
        "falsePositive",
        "trueNegative",
        "falseNegative",
    }


def test_evaluate_rejects_an_unknown_split():
    with TestClient(app) as client:
        resp = client.post("/ml/evaluate", json={"dataDir": DATA_DIR, "split": "not_a_real_split"})
    assert resp.status_code == 400


def test_analyze_rejects_a_negative_amount():
    with TestClient(app) as client:
        resp = client.post("/ml/analyze/transaction", json={"transactionId": "bad", "amount": -50})
    assert resp.status_code == 422


class TestModelNotLoaded:
    """Simulates the ML-service-unavailable / not-yet-trained scenario the Node backend must fall back on."""

    def test_analyze_returns_503_when_no_model_is_loaded(self):
        with TestClient(app) as client:
            original = model_state.get_models()
            model_state._state["models"] = None
            try:
                resp = client.post("/ml/analyze/transaction", json={"transactionId": "t1", "amount": 100})
                assert resp.status_code == 503
                assert resp.json()["detail"]["code"] == "MODEL_NOT_LOADED"
            finally:
                model_state._state["models"] = original
