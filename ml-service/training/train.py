"""
Trains the Isolation Forest and Random Forest models on the train
split and persists them to disk.

Usage:
    python -m training.train --data-dir /path/to/payguard_datasets --model-dir ./models

Only the train split is ever used for fitting. Validation and
test_heldout rows are computed with features (via the shared
load_full_featured_dataset pipeline) but are never shown to
model.fit() -- see evaluate.py for how they're used.
"""
from __future__ import annotations

import argparse
import sys

from app.core.dataset import load_full_featured_dataset
from app.core.features import FEATURE_COLUMNS
from app.core.model import save_models, train_all


def main() -> None:
    parser = argparse.ArgumentParser(description="Train PayGuard AI's risk models")
    parser.add_argument("--data-dir", required=True, help="Directory containing the supplied CSV datasets")
    parser.add_argument("--model-dir", default="./models", help="Where to persist trained model artifacts")
    args = parser.parse_args()

    print(f"Loading and engineering features from {args.data_dir} ...")
    full = load_full_featured_dataset(args.data_dir)

    train = full[full["split"] == "train"]
    print(f"Train split: {len(train)} rows ({train['groundTruthRisk'].mean():.1%} suspicious)")

    X_train = train[FEATURE_COLUMNS]
    y_train = train["groundTruthRisk"]

    print("Training Isolation Forest (unsupervised) and Random Forest (supervised) ...")
    models = train_all(X_train, y_train)

    save_models(models, args.model_dir)
    print(f"Saved model artifacts to {args.model_dir} (version {models.trained_at})")
    print(f"  - {len(FEATURE_COLUMNS)} features: {', '.join(FEATURE_COLUMNS)}")


if __name__ == "__main__":
    sys.exit(main())
