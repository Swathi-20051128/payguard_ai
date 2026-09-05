"""
Evaluation against a held-out (or validation) set. Every number here
is computed from actual model predictions on actual labeled data --
none of it is hardcoded or simulated. See training/evaluate.py for
the standalone CLI script and app/routes/ml.py's POST /ml/evaluate
for the live API version.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

from app.core.features import FEATURE_COLUMNS
from app.core.model import LoadedModels


@dataclass
class EvaluationReport:
    rowCount: int
    positiveCount: int
    positiveRate: float

    precision: float
    recall: float
    f1: float
    prAuc: float
    falsePositiveRate: float
    falseNegativeRate: float
    confusionMatrix: dict = field(default_factory=dict)

    averageInferenceLatencyMs: float = 0.0
    throughputPerSecond: float = 0.0

    decisionThreshold: float = 0.5
    modelVersion: str = ""


def evaluate(models: LoadedModels, df: pd.DataFrame, decision_threshold: float = 0.5) -> EvaluationReport:
    """
    Scores every row in df (must already have FEATURE_COLUMNS +
    groundTruthRisk) with the Random Forest's supervised probability,
    applies decision_threshold to get binary predictions, and computes
    the full metric suite. Latency/throughput are measured on the
    ACTUAL batch scoring performed here, not estimated.
    """
    X = df[FEATURE_COLUMNS]
    y_true = df["groundTruthRisk"].astype(int).values

    start = time.perf_counter()
    y_proba = models.random_forest.predict_proba(X)[:, 1]
    elapsed = time.perf_counter() - start

    y_pred = (y_proba >= decision_threshold).astype(int)

    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()

    precision = precision_score(y_true, y_pred, zero_division=0)
    recall = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    pr_auc = average_precision_score(y_true, y_proba)

    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    fnr = fn / (fn + tp) if (fn + tp) > 0 else 0.0

    row_count = len(df)
    avg_latency_ms = (elapsed / row_count) * 1000 if row_count else 0.0
    throughput = row_count / elapsed if elapsed > 0 else 0.0

    return EvaluationReport(
        rowCount=row_count,
        positiveCount=int(y_true.sum()),
        positiveRate=float(y_true.mean()),
        precision=round(float(precision), 4),
        recall=round(float(recall), 4),
        f1=round(float(f1), 4),
        prAuc=round(float(pr_auc), 4),
        falsePositiveRate=round(float(fpr), 4),
        falseNegativeRate=round(float(fnr), 4),
        confusionMatrix={
            "truePositive": int(tp),
            "falsePositive": int(fp),
            "trueNegative": int(tn),
            "falseNegative": int(fn),
        },
        averageInferenceLatencyMs=round(avg_latency_ms, 4),
        throughputPerSecond=round(throughput, 1),
        decisionThreshold=decision_threshold,
        modelVersion=models.metadata.get("modelVersion", "unknown"),
    )


def evaluate_by_scenario(models: LoadedModels, df: pd.DataFrame, decision_threshold: float = 0.5) -> dict:
    """
    Per-fraudScenario recall breakdown -- surfaces exactly which
    attack patterns the model catches well vs. poorly, rather than
    hiding that behind one aggregate number. (See known-limitations
    notes: some scenario types in the supplied dataset have very weak
    structural signal in the available fields.)
    """
    X = df[FEATURE_COLUMNS]
    y_proba = models.random_forest.predict_proba(X)[:, 1]
    y_pred = (y_proba >= decision_threshold).astype(int)

    result = {}
    working = df.copy()
    working["_pred"] = y_pred
    for scenario, group in working.groupby("fraudScenario"):
        if scenario == "NORMAL":
            continue
        caught = int(group["_pred"].sum())
        total = len(group)
        result[scenario] = {"total": total, "caught": caught, "recall": round(caught / total, 4) if total else 0.0}
    return result
