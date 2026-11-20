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


def _intensity_prefix_candidates(intensity_mode: str | None, intensity_prefix: str | None) -> list[str]:
    """Ordered prefixes to try when resolving sample intensity columns."""
    prefixes: list[str] = []
    if intensity_prefix:
        prefixes.append(intensity_prefix)
    mode = (intensity_mode or "lfq").lower()
    if mode in ("ibaq", "iBAQ".lower()):
        prefixes.extend(["iBAQ ", "LFQ intensity "])
    elif mode in ("intensity", "raw_intensity"):
        prefixes.extend(["Intensity ", "LFQ intensity ", "iBAQ "])
    else:  # lfq default
        prefixes.extend(["LFQ intensity ", "iBAQ ", "Intensity "])
    # FragPipe-style and exact key last
    prefixes.extend(["", f"__fragpipe__"])
    # dedupe preserving order
    seen = set()
    out = []
    for p in prefixes:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _detect_intensity_columns(
    df: pd.DataFrame,
    column_groups: dict[str, str],
    intensity_prefix: str | None = None,
    intensity_mode: str | None = None,
) -> dict[str, str]:
    """
    Map logical sample keys in column_groups to actual dataframe columns.

    column_groups keys may be:
      - exact column names
      - MaxQuant sample suffixes matching 'LFQ intensity <suffix>' or 'iBAQ <suffix>'
      - FragPipe sample names matching '<sample> MaxLFQ Intensity'
    """
    cols = list(df.columns)
    resolved: dict[str, str] = {}
    prefixes = _intensity_prefix_candidates(intensity_mode, intensity_prefix)

    for key, group in column_groups.items():
        if key in cols:
            resolved[key] = key
            continue
        found = None
        for prefix in prefixes:
            if prefix == "__fragpipe__":
                frag = f"{key} MaxLFQ Intensity"
                if frag in cols:
                    found = frag
                    break
                continue
            if prefix == "":
                continue
            cand = f"{prefix}{key}"
            if cand in cols:
                found = cand
                break
        if found is None:
            # trailing-token fallback
            for col in cols:
                if col.endswith(key) and any(
                    tok in col for tok in ("LFQ", "iBAQ", "Intensity", "intensity")
                ):
                    found = col
                    break
                if re.fullmatch(rf"(?i)(?:lfq intensity|ibaq|intensity)[ _]{re.escape(key)}", col):
                    found = col
                    break
        if found is None:
            raise KeyError(
                f"Could not resolve intensity column for sample key '{key}' "
                f"(mode={intensity_mode!r}, prefix={intensity_prefix!r})."
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

    intensity_mode = ds.get("intensity_mode") or ds.get("quant") or "lfq"
    resolved = _detect_intensity_columns(
        df,
        column_groups,
        intensity_prefix=ds.get("intensity_prefix"),
        intensity_mode=intensity_mode,
    )
    contam_mode = filters.get("contam_filter", "maxquant_or_fragpipe")
    df = _filter_contaminants(df, protein_col, contam_mode)

    ann_cfg = cfg.get("annotation", {}) or {}
    gene_col = ann_cfg.get("gene_column")
    if gene_col and gene_col not in df.columns:
        gene_col = None
    if gene_col is None:
        for cand in ("Gene names", "Gene", "gene"):
            if cand in df.columns:
                gene_col = cand
                break
    fasta_col = ann_cfg.get("fasta_header_column")
    if fasta_col and fasta_col not in df.columns:
        fasta_col = None
    if fasta_col is None and "Fasta headers" in df.columns:
        fasta_col = "Fasta headers"

    keep_cols = [protein_col] + list(resolved.values())
    if gene_col:
        keep_cols.append(gene_col)
    if fasta_col:
        keep_cols.append(fasta_col)
    # unique preserve order
    keep_cols = list(dict.fromkeys(keep_cols))
    intensity = df[keep_cols].copy()
    rename_map = {protein_col: "Protein", **{v: k for k, v in resolved.items()}}
    if gene_col:
        rename_map[gene_col] = "Gene"
    if fasta_col:
        rename_map[fasta_col] = "Fasta headers"
    intensity = intensity.rename(columns=rename_map)

    # collapse duplicate protein rows (rare) by max on numeric sample cols
    sample_cols = list(column_groups.keys())
    agg = {c: "max" for c in sample_cols}
    if "Gene" in intensity.columns:
        agg["Gene"] = "first"
    if "Fasta headers" in intensity.columns:
        agg["Fasta headers"] = "first"
    intensity = intensity.groupby("Protein", as_index=False).agg(agg)

    zeros_as_nan = bool(filters.get("zeros_as_nan", True))
    for col in sample_cols:
        intensity[col] = pd.to_numeric(intensity[col], errors="coerce")
        if zeros_as_nan:
            intensity.loc[intensity[col] <= 0, col] = np.nan

    analysis_dir = out_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    wide_path = analysis_dir / "abundance_wide.csv"
    intensity[["Protein", *sample_cols]].to_csv(wide_path, index=False)

    # annotation for viz
    ann_rows = []
    for sample, group in column_groups.items():
        ann_rows.append({"sample": sample, "condition": group, "group": group})
    ann = pd.DataFrame(ann_rows)
    ann_path = analysis_dir / "experiment_annotation.tsv"
    ann.to_csv(ann_path, sep="\t", index=False)

    column_map = {
        "protein_col": protein_col,
        "intensity_mode": intensity_mode,
        "resolved_columns": resolved,
        "column_groups": column_groups,
        "gene_column": gene_col,
        "fasta_header_column": fasta_col,
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
        "intensity_mode": intensity_mode,
        "gene_column": gene_col,
        "fasta_header_column": fasta_col,
    }
