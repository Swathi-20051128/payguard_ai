"""
The ML service's public prediction/evaluation API. Every route
degrades gracefully rather than 500ing when the model isn't loaded
yet (spec's failure-handling requirement: "ML service unavailable ->
use rule-based fallback" on the Node side depends on the ML service
returning a clear, typed signal that it can't currently score,
rather than an opaque error).
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from app import model_state
from app.core.analyze import build_feature_row
from app.core.dataset import load_full_featured_dataset
from app.core.evaluation import evaluate, evaluate_by_scenario
from app.core.model import predict_one
from app.core.schemas import (
    AnalyzeBatchRequest,
    AnalyzeBatchResponse,
    AnalyzeTransactionResponse,
    EvaluateRequest,
    EvaluateResponse,
    TransactionInput,
)

router = APIRouter()


def _require_models():
    models = model_state.get_models()
    if models is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_NOT_LOADED",
                "message": "No trained model is currently loaded. Run training first, or the caller should fall back to rule-based detection.",
            },
        )
    return models


def _score_one(txn: TransactionInput, models) -> AnalyzeTransactionResponse:
    feature_row, used_default = build_feature_row(txn)
    result = predict_one(models, feature_row)

    return AnalyzeTransactionResponse(
        transactionId=txn.transactionId,
        anomalyScore=result.anomaly_score,
        supervisedProbability=result.supervised_probability,
        modelVersion=models.metadata.get("modelVersion", "unknown"),
        usedDefaultFeatures=used_default,
        confidence="reduced" if used_default else "high",
        topContributingFeatures=result.top_contributing_features,
        latencyMs=result.latency_ms,
    )


@router.post("/ml/analyze/transaction", response_model=AnalyzeTransactionResponse)
def analyze_transaction(txn: TransactionInput):
    models = _require_models()
    return _score_one(txn, models)


@router.post("/ml/analyze/batch", response_model=AnalyzeBatchResponse)
def analyze_batch(request: AnalyzeBatchRequest):
    models = _require_models()

    start = time.perf_counter()
    results = [_score_one(txn, models) for txn in request.transactions]
    elapsed = time.perf_counter() - start

    total = len(results)
    avg_latency = (elapsed / total) * 1000 if total else 0.0
    throughput = total / elapsed if elapsed > 0 else 0.0

    return AnalyzeBatchResponse(
        results=results,
        totalProcessed=total,
        averageLatencyMs=round(avg_latency, 3),
        throughputPerSecond=round(throughput, 1),
    )


@router.post("/ml/evaluate", response_model=EvaluateResponse)
def run_evaluation(request: EvaluateRequest):
    models = _require_models()

    try:
        full = load_full_featured_dataset(request.dataDir)
    except FileNotFoundError as err:
        raise HTTPException(status_code=400, detail={"code": "DATA_NOT_FOUND", "message": str(err)})

    if request.split not in full["split"].unique().tolist():
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_SPLIT", "message": f"Unknown split '{request.split}'"},
        )

    subset = full[full["split"] == request.split]
    report = evaluate(models, subset, decision_threshold=request.decisionThreshold)
    by_scenario = evaluate_by_scenario(models, subset, decision_threshold=request.decisionThreshold)

    return EvaluateResponse(**report.__dict__, byScenario=by_scenario)
