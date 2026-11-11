#!/usr/bin/env python3
"""Rebuild clean, label-enriched VOC and TPHiS CSVs from Bath archive ZIPs."""
from __future__ import annotations
import argparse, json, zipfile
from pathlib import Path
import numpy as np
import pandas as pd

STAGES = {1: "unripe", 2: "ripe", 3: "beyond_ripe", 4: "overripe", 5: "gone_off"}

def load_split(archive: zipfile.ZipFile, prefix: str, split: str) -> pd.DataFrame:
    x_name, y_name = f"{prefix}_x_{split}.csv", f"{prefix}_y_{split}.csv"
    with archive.open(x_name) as handle:
        x = pd.read_csv(handle)
    with archive.open(y_name) as handle:
        y = pd.read_csv(handle)
    if "Unnamed: 0" not in x or "Unnamed: 0" not in y or "0" not in y:
        raise ValueError(f"Unexpected schema in {x_name} or {y_name}")
    if not x["Unnamed: 0"].equals(y["Unnamed: 0"]):
        raise ValueError(f"Feature/label index mismatch in {prefix}/{split}")
    if x["Unnamed: 0"].duplicated().any():
        raise ValueError(f"Duplicate source index in {prefix}/{split}")
    x = x.rename(columns={"Unnamed: 0": "source_row_index"})
    y = y.rename(columns={"Unnamed: 0": "source_row_index", "0": "ripeness_stage_id"})
    frame = x.merge(y, on="source_row_index", how="inner", validate="one_to_one", sort=False)
    if len(frame) != len(x):
        raise ValueError(f"Rows lost while joining {prefix}/{split}")
    frame["ripeness_stage_id"] = pd.to_numeric(frame["ripeness_stage_id"], errors="raise").astype(int)
    if not set(frame["ripeness_stage_id"].unique()).issubset(STAGES):
        raise ValueError(f"Unknown class IDs in {prefix}/{split}")
    features = [c for c in frame.columns if c not in {"source_row_index", "ripeness_stage_id"}]
    frame[features] = frame[features].apply(pd.to_numeric, errors="raise")
    values = frame[features].to_numpy(dtype=float)
    if not np.isfinite(values).all() or frame[features].isna().any().any():
        raise ValueError(f"Missing or non-finite feature values in {prefix}/{split}")
    frame["ripeness_stage"] = frame["ripeness_stage_id"].map(STAGES)
    return frame[["source_row_index"] + features + ["ripeness_stage_id", "ripeness_stage"]]

def process_zip(zip_path: Path, prefix: str, output_dir: Path) -> dict:
    results = {}
    with zipfile.ZipFile(zip_path) as archive:
        for split in ("train", "test"):
            frame = load_split(archive, prefix, split)
            target = output_dir / "data" / "processed" / f"{prefix.lower()}_{split}.csv"
            target.parent.mkdir(parents=True, exist_ok=True)
            frame.to_csv(target, index=False, float_format="%.10g")
            features = [c for c in frame.columns if c not in {"source_row_index", "ripeness_stage_id", "ripeness_stage"}]
            results[f"{prefix}_{split}"] = {
                "rows": int(len(frame)), "feature_count": len(features), "features": features,
                "class_counts": {STAGES[int(k)]: int(v) for k, v in frame["ripeness_stage_id"].value_counts().sort_index().items()},
                "missing_values": int(frame.isna().sum().sum()),
                "duplicate_source_indices": int(frame["source_row_index"].duplicated().sum()),
            }
    return results

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voc-zip", type=Path, required=True)
    parser.add_argument("--tphis-zip", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    args = parser.parse_args()
    report = {
        "source": "University of Bath banana ripeness dataset, DOI 10.15125/BATH-01459",
        "label_mapping": STAGES,
        "preprocessing": [
            "Validated feature/label source indices and joined one-to-one",
            "Preserved source train/test splits and feature values",
            "Added readable five-stage target labels",
            "Checked numeric, finite, missing and duplicate values",
            "No imputation or scaling applied to exported files",
        ],
        "datasets": {},
    }
    report["datasets"].update(process_zip(args.voc_zip, "VOC", args.output_dir))
    report["datasets"].update(process_zip(args.tphis_zip, "TPHiS", args.output_dir))
    report_path = args.output_dir / "reports" / "preprocessing_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
