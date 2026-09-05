"""
Model layer: trains, persists, loads, and scores with two models:

- Isolation Forest (unsupervised) -- doesn't need labels, learns what
  "normal" looks like and flags what doesn't fit. Trained on the
  train split only (though it never sees train's labels either).
- Random Forest (supervised) -- trained on the train split WITH
  labels (groundTruthRisk). Used both for its own probability output
  and as the basis for SHAP explanations, since SHAP's TreeExplainer
  is fast and exact for tree ensembles (KernelExplainer, needed for
  Isolation Forest, is much slower and is skipped here -- see
  _top_shap_contributors docstring).

Both models are tree-based, so no feature scaling is needed.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import IsolationForest, RandomForestClassifier

from app.core.features import FEATURE_COLUMNS

MODEL_VERSION = "v1"
ISOLATION_FOREST_FILENAME = f"isolation_forest_{MODEL_VERSION}.joblib"
RANDOM_FOREST_FILENAME = f"random_forest_{MODEL_VERSION}.joblib"
METADATA_FILENAME = f"metadata_{MODEL_VERSION}.json"


@dataclass
class TrainedModels:
    isolation_forest: IsolationForest
    random_forest: RandomForestClassifier
    # Isolation Forest's raw score_samples() output isn't naturally on
    # a 0-100 scale -- these calibration bounds (observed on the
    # training set) are used to rescale it. See anomaly_score_to_0_100.
    if_score_min: float
    if_score_max: float
    trained_at: str
    train_row_count: int


def train_isolation_forest(X_train: pd.DataFrame) -> IsolationForest:
    model = IsolationForest(
        n_estimators=200,
        contamination="auto",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train)
    return model


def train_random_forest(X_train: pd.DataFrame, y_train: pd.Series) -> RandomForestClassifier:
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=3,
        class_weight="balanced",  # ~9% positive rate -- don't let the model just predict "normal" for everything
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    return model


def train_all(X_train: pd.DataFrame, y_train: pd.Series) -> TrainedModels:
    iso = train_isolation_forest(X_train)
    rf = train_random_forest(X_train, y_train)

    raw_scores = -iso.score_samples(X_train)  # higher = more anomalous
    return TrainedModels(
        isolation_forest=iso,
        random_forest=rf,
        if_score_min=float(raw_scores.min()),
        if_score_max=float(raw_scores.max()),
        trained_at=pd.Timestamp.utcnow().isoformat(),
        train_row_count=len(X_train),
    )


def anomaly_score_to_0_100(raw_scores: np.ndarray, score_min: float, score_max: float) -> np.ndarray:
    """Min-max scales Isolation Forest's raw anomaly scores (calibrated against the training set) into a 0-100 range, clipped at the edges for scores outside the training set's observed range."""
    if score_max <= score_min:
        return np.zeros_like(raw_scores)
    scaled = (raw_scores - score_min) / (score_max - score_min) * 100
    return np.clip(scaled, 0, 100)


def save_models(models: TrainedModels, model_dir: str) -> None:
    Path(model_dir).mkdir(parents=True, exist_ok=True)
    joblib.dump(models.isolation_forest, Path(model_dir) / ISOLATION_FOREST_FILENAME)
    joblib.dump(models.random_forest, Path(model_dir) / RANDOM_FOREST_FILENAME)
    metadata = {
        "modelVersion": MODEL_VERSION,
        "featureColumns": FEATURE_COLUMNS,
        "ifScoreMin": models.if_score_min,
        "ifScoreMax": models.if_score_max,
        "trainedAt": models.trained_at,
        "trainRowCount": models.train_row_count,
    }
    with open(Path(model_dir) / METADATA_FILENAME, "w") as f:
        json.dump(metadata, f, indent=2)


@dataclass
class LoadedModels:
    isolation_forest: IsolationForest
    random_forest: RandomForestClassifier
    metadata: dict
    shap_explainer: object


def load_models(model_dir: str) -> Optional[LoadedModels]:
    """Returns None if no persisted model is found (e.g. training hasn't run yet) rather than raising -- callers use this to trigger fallback behavior."""
    iso_path = Path(model_dir) / ISOLATION_FOREST_FILENAME
    rf_path = Path(model_dir) / RANDOM_FOREST_FILENAME
    meta_path = Path(model_dir) / METADATA_FILENAME

    if not (iso_path.exists() and rf_path.exists() and meta_path.exists()):
        return None

    iso = joblib.load(iso_path)
    rf = joblib.load(rf_path)
    with open(meta_path) as f:
        metadata = json.load(f)

    explainer = shap.TreeExplainer(rf)

    return LoadedModels(isolation_forest=iso, random_forest=rf, metadata=metadata, shap_explainer=explainer)


@dataclass
class PredictionResult:
    anomaly_score: float  # 0-100, Isolation Forest based
    supervised_probability: float  # 0-100, Random Forest based
    top_contributing_features: list
    latency_ms: float


def predict_one(models: LoadedModels, feature_row: pd.DataFrame) -> PredictionResult:
    """Scores a single transaction's feature row (a 1-row DataFrame with FEATURE_COLUMNS). Also used internally by predict_batch -- kept separate so the single-transaction API endpoint can report accurate per-request latency."""
    start = time.perf_counter()

    raw_if_score = -models.isolation_forest.score_samples(feature_row)
    anomaly_score = float(
        anomaly_score_to_0_100(raw_if_score, models.metadata["ifScoreMin"], models.metadata["ifScoreMax"])[0]
    )

    supervised_proba = float(models.random_forest.predict_proba(feature_row)[0][1] * 100)

    top_features = _top_shap_contributors(models.shap_explainer, feature_row)

    latency_ms = (time.perf_counter() - start) * 1000

    return PredictionResult(
        anomaly_score=round(anomaly_score, 2),
        supervised_probability=round(supervised_proba, 2),
        top_contributing_features=top_features,
        latency_ms=round(latency_ms, 3),
    )


def _top_shap_contributors(explainer, feature_row: pd.DataFrame, top_n: int = 3) -> list:
    """
    Returns the top_n features that pushed the Random Forest's
    prediction most strongly toward "suspicious", with their SHAP
    contribution values -- the basis for human-readable explanations
    (Feature 7's explainability requirement). SHAP's TreeExplainer is
    used because it's fast and exact for tree ensembles; the
    Isolation Forest side isn't explained via SHAP (KernelExplainer,
    the only SHAP path for it, is far slower) -- its anomaly score is
    reported as a raw signal instead, without a per-feature breakdown.
    """
    shap_values = explainer.shap_values(feature_row)

    # Binary classifier: shap_values is [class_0_values, class_1_values]
    # in older SHAP versions, or a single array with a class axis in
    # newer ones. Normalize to "contribution toward class 1 (suspicious)".
    if isinstance(shap_values, list):
        values = shap_values[1][0]
    elif shap_values.ndim == 3:
        values = shap_values[0, :, 1]
    else:
        values = shap_values[0]

    contributions = list(zip(FEATURE_COLUMNS, values, feature_row.iloc[0].tolist()))
    contributions.sort(key=lambda c: abs(c[1]), reverse=True)

    return [
        {"feature": name, "value": round(float(val), 4), "contribution": round(float(contrib), 4)}
        for name, contrib, val in contributions[:top_n]
    ]
