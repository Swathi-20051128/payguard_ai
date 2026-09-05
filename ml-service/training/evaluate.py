"""
Evaluates the persisted models against the held-out test set (or
validation set) and prints a report. Every number is computed live
against real labeled data -- see app/core/evaluation.py.

Usage:
    python -m training.evaluate --data-dir /path/to/payguard_datasets --model-dir ./models
    python -m training.evaluate --data-dir /path/to/payguard_datasets --model-dir ./models --split validation
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from app.core.dataset import load_full_featured_dataset
from app.core.evaluation import evaluate, evaluate_by_scenario
from app.core.model import load_models


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate PayGuard AI's risk models")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--model-dir", default="./models")
    parser.add_argument("--split", default="test_heldout", choices=["validation", "test_heldout"])
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--output", default=None, help="Optional path to write the JSON report to")
    args = parser.parse_args()

    models = load_models(args.model_dir)
    if models is None:
        print("No trained models found -- run training.train first.", file=sys.stderr)
        sys.exit(1)

    full = load_full_featured_dataset(args.data_dir)
    subset = full[full["split"] == args.split]
    print(f"Evaluating on {args.split}: {len(subset)} rows ({subset['groundTruthRisk'].mean():.1%} suspicious)")

    report = evaluate(models, subset, decision_threshold=args.threshold)
    scenario_breakdown = evaluate_by_scenario(models, subset, decision_threshold=args.threshold)

    print()
    print(f"Precision:            {report.precision}")
    print(f"Recall:               {report.recall}")
    print(f"F1 score:             {report.f1}")
    print(f"PR-AUC:               {report.prAuc}")
    print(f"False positive rate:  {report.falsePositiveRate}")
    print(f"False negative rate:  {report.falseNegativeRate}")
    print(f"Confusion matrix:     {report.confusionMatrix}")
    print(f"Avg inference latency:{report.averageInferenceLatencyMs} ms/row")
    print(f"Throughput:           {report.throughputPerSecond} rows/sec")
    print()
    print("Recall by fraud scenario:")
    for scenario, stats in sorted(scenario_breakdown.items(), key=lambda kv: -kv[1]["recall"]):
        print(f"  {scenario:24s} {stats['caught']:3d}/{stats['total']:3d}  ({stats['recall']:.1%})")

    if args.output:
        with open(args.output, "w") as f:
            json.dump({"report": asdict(report), "byScenario": scenario_breakdown}, f, indent=2)
        print(f"\nWrote report to {args.output}")


if __name__ == "__main__":
    main()
