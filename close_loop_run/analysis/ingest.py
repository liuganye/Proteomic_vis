"""Ingest quantified protein tables (FragPipe MaxLFQ or MaxQuant proteinGroups)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


CONTAM_PREFIXES = ("contam_", "CON__", "REV__")


def _detect_protein_col(df: pd.DataFrame, preferred: str | None) -> str:
    if preferred and preferred in df.columns:
        return preferred
    for cand in (
        "Majority protein IDs",
        "Protein IDs",
        "Protein",
        "Protein ID",
        "protein",
    ):
        if cand in df.columns:
            return cand
    raise ValueError(f"No protein ID column found among {list(df.columns)[:30]}...")


def _detect_intensity_columns(
    df: pd.DataFrame,
    column_groups: dict[str, str],
    intensity_prefix: str | None = None,
) -> dict[str, str]:
    """
    Map logical sample keys in column_groups to actual dataframe columns.

    column_groups keys may be:
      - exact column names
      - MaxQuant sample suffixes matching 'LFQ intensity <suffix>'
      - FragPipe sample names matching '<sample> MaxLFQ Intensity'
    """
    cols = list(df.columns)
    resolved: dict[str, str] = {}

    prefixes = []
    if intensity_prefix:
        prefixes.append(intensity_prefix)
    prefixes.extend(
        [
            "LFQ intensity ",
            "MaxLFQ Intensity ",  # unlikely
            "",  # exact
        ]
    )

    for key, group in column_groups.items():
        if key in cols:
            resolved[key] = key
            continue
        # FragPipe: "<sample> MaxLFQ Intensity"
        frag = f"{key} MaxLFQ Intensity"
        if frag in cols:
            resolved[key] = frag
            continue
        # MaxQuant: "LFQ intensity <key>"
        mq = f"LFQ intensity {key}"
        if mq in cols:
            resolved[key] = mq
            continue
        # Try prefix variants / case-insensitive match on trailing token
        found = None
        for col in cols:
            if col.endswith(key) and ("LFQ" in col or "Intensity" in col or "intensity" in col):
                found = col
                break
            if re.fullmatch(rf"(?i)lfq intensity[ _]{re.escape(key)}", col):
                found = col
                break
        if found is None:
            raise KeyError(
                f"Could not resolve intensity column for sample key '{key}'. "
                f"Looked for exact / 'LFQ intensity {key}' / '{key} MaxLFQ Intensity'."
            )
        resolved[key] = found
    return resolved


def _filter_contaminants(df: pd.DataFrame, protein_col: str, mode: str) -> pd.DataFrame:
    if mode in (None, "none", False):
        return df
    out = df
    if "Reverse" in out.columns:
        out = out[out["Reverse"].fillna("").astype(str).str.strip() != "+"]
    if "Potential contaminant" in out.columns:
        out = out[out["Potential contaminant"].fillna("").astype(str).str.strip() != "+"]
    if "Only identified by site" in out.columns:
        out = out[out["Only identified by site"].fillna("").astype(str).str.strip() != "+"]
    if mode in ("fragpipe_contam_star", "contam_prefix", "maxquant_or_fragpipe"):
        ids = out[protein_col].astype(str)
        mask = ~ids.str.lower().str.startswith(CONTAM_PREFIXES)
        # also drop CON__/REV__ anywhere in semicolon-joined MaxQuant IDs
        mask &= ~ids.str.contains(r"(?i)(?:^|;)(?:CON__|REV__)", regex=True, na=False)
        out = out[mask]
    return out.reset_index(drop=True)


def ingest_matrix(cfg: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    ds = cfg.get("dataset", {})
    samples = cfg.get("samples", {})
    filters = cfg.get("filters", {})

    matrix_path = Path(ds["matrix_path"])
    fmt = (ds.get("format") or matrix_path.suffix.lstrip(".")).lower()
    sep = "\t" if fmt in ("tsv", "txt", "") else ","
    df = pd.read_csv(matrix_path, sep=sep, low_memory=False)

    protein_col = _detect_protein_col(df, ds.get("protein_col"))
    column_groups: dict[str, str] = dict(samples.get("column_groups") or {})
    if not column_groups:
        raise ValueError("samples.column_groups is required")

    resolved = _detect_intensity_columns(df, column_groups, ds.get("intensity_prefix"))
    contam_mode = filters.get("contam_filter", "maxquant_or_fragpipe")
    df = _filter_contaminants(df, protein_col, contam_mode)

    intensity = df[[protein_col] + list(resolved.values())].copy()
    intensity = intensity.rename(columns={protein_col: "Protein", **{v: k for k, v in resolved.items()}})
    # collapse duplicate protein rows (rare) by max
    intensity = intensity.groupby("Protein", as_index=False).max()

    zeros_as_nan = bool(filters.get("zeros_as_nan", True))
    sample_cols = list(column_groups.keys())
    for col in sample_cols:
        intensity[col] = pd.to_numeric(intensity[col], errors="coerce")
        if zeros_as_nan:
            intensity.loc[intensity[col] <= 0, col] = np.nan

    analysis_dir = out_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    wide_path = analysis_dir / "abundance_wide.csv"
    intensity.to_csv(wide_path, index=False)

    # annotation for viz
    ann_rows = []
    for sample, group in column_groups.items():
        ann_rows.append({"sample": sample, "condition": group, "group": group})
    ann = pd.DataFrame(ann_rows)
    ann_path = analysis_dir / "experiment_annotation.tsv"
    ann.to_csv(ann_path, sep="\t", index=False)

    column_map = {
        "protein_col": protein_col,
        "resolved_columns": resolved,
        "column_groups": column_groups,
        "n_proteins": int(len(intensity)),
        "n_samples": len(sample_cols),
        "source_matrix": str(matrix_path),
    }
    map_path = analysis_dir / "column_map.json"
    map_path.write_text(json.dumps(column_map, indent=2), encoding="utf-8")

    control_label = samples.get("control_label", "control")
    treatment_label = samples.get("treatment_label", "treatment")
    control_cols = [s for s, g in column_groups.items() if g == control_label]
    treatment_cols = [s for s, g in column_groups.items() if g == treatment_label]
    qc_cols = [s for s, g in column_groups.items() if g == "qc"]
    contrast_cols = control_cols + treatment_cols

    return {
        "matrix": intensity,
        "sample_cols": sample_cols,
        "control_cols": control_cols,
        "treatment_cols": treatment_cols,
        "qc_cols": qc_cols,
        "contrast_cols": contrast_cols,
        "column_groups": column_groups,
        "control_label": control_label,
        "treatment_label": treatment_label,
        "wide_path": wide_path,
        "annotation_path": ann_path,
        "column_map_path": map_path,
        "n_proteins": int(len(intensity)),
    }
