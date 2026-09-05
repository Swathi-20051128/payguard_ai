"""
Builds the full featured dataset with split labels attached.

The supplied train.csv / validation.csv / test_heldout.csv are a
RANDOM row split (verified: transactionIds are not in chronological
order within any of the three files), not a chronological split.
Computing contextual features (a device's recent activity, a
customer's spending history, etc.) using only rows within one split
would be unrealistic and would starve most rows of real context --
in production, ALL prior transactions are visible regardless of
which "split" a row would later be assigned to for evaluation
purposes.

So features are engineered once, over the full transaction history
(transactions_master.csv), and the train/validation/test_heldout
files are only used afterward to label which rows belong to which
split -- for deciding what a model is fit on vs. evaluated on, not
for deciding what context it can see.
"""
from __future__ import annotations

import pandas as pd

from app.core.features import engineer_features, load_raw

SPLIT_FILES = {
    "train": "train.csv",
    "validation": "validation.csv",
    "test_heldout": "test_heldout.csv",
}


def load_full_featured_dataset(data_dir: str) -> pd.DataFrame:
    master = load_raw(f"{data_dir}/transactions_master.csv")
    featured = engineer_features(master)

    split_of: dict[str, str] = {}
    for split_name, filename in SPLIT_FILES.items():
        ids = pd.read_csv(f"{data_dir}/{filename}", usecols=["transactionId"])["transactionId"]
        for txn_id in ids:
            split_of[txn_id] = split_name

    featured["split"] = featured["transactionId"].map(split_of)

    unassigned = featured["split"].isna().sum()
    if unassigned > 0:
        raise ValueError(
            f"{unassigned} rows in transactions_master.csv were not found in any of "
            f"train/validation/test_heldout.csv — the split files may be out of sync "
            f"with the master file."
        )

    return featured
