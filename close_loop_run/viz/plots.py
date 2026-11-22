"""Headless matplotlib QC + volcano plots for smoke Automation 2."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402


def _save(fig: plt.Figure, path: Path, dpi: int = 150) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    return path


def plot_missingness(
    wide: pd.DataFrame,
    sample_cols: list[str],
    annotation: pd.DataFrame | None,
    out_path: Path,
    dpi: int = 150,
) -> Path:
    miss = wide[sample_cols].isna().mean()
    fig, ax = plt.subplots(figsize=(max(6, 0.45 * len(sample_cols)), 4))
    colors = None
    if annotation is not None and "condition" in annotation.columns:
        cond = annotation.set_index("sample")["condition"]
        palette = {}
        uniq = list(dict.fromkeys(cond.reindex(sample_cols).tolist()))
        cmap = plt.cm.tab10(np.linspace(0, 1, max(len(uniq), 1)))
        for i, u in enumerate(uniq):
            palette[u] = cmap[i]
        colors = [palette.get(cond.get(s), "#888888") for s in sample_cols]
    ax.bar(range(len(sample_cols)), miss.values, color=colors or "#4c78a8")
    ax.set_xticks(range(len(sample_cols)))
    ax.set_xticklabels(sample_cols, rotation=45, ha="right")
    ax.set_ylabel("Fraction missing")
    ax.set_title("QC — missingness by sample")
    ax.set_ylim(0, 1)
    ax.axhline(0.35, ls="--", color="#bbbbbb", lw=0.8)
    return _save(fig, out_path, dpi)


def plot_intensity_hist(
    wide: pd.DataFrame,
    sample_cols: list[str],
    out_path: Path,
    dpi: int = 150,
) -> Path:
    vals = wide[sample_cols].to_numpy(dtype=float).ravel()
    vals = vals[np.isfinite(vals) & (vals > 0)]
    log10 = np.log10(vals) if vals.size else np.array([])
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hist(log10, bins=60, color="#4c78a8", edgecolor="white", linewidth=0.3)
    ax.set_xlabel("log10(intensity)")
    ax.set_ylabel("Count")
    ax.set_title("QC — intensity distribution")
    return _save(fig, out_path, dpi)


def plot_intensity_box(
    wide: pd.DataFrame,
    sample_cols: list[str],
    out_path: Path,
    dpi: int = 150,
) -> Path:
    data = []
    labels = []
    for s in sample_cols:
        v = wide[s].to_numpy(dtype=float)
        v = v[np.isfinite(v) & (v > 0)]
        if v.size:
            data.append(np.log10(v))
            labels.append(s)
    fig, ax = plt.subplots(figsize=(max(6, 0.5 * len(labels)), 4))
    if data:
        ax.boxplot(data, tick_labels=labels, showfliers=False)
        for tick in ax.get_xticklabels():
            tick.set_rotation(45)
            tick.set_ha("right")
    else:
        ax.set_xticks([])

    ax.set_ylabel("log10(intensity)")
    ax.set_title("QC — intensity by sample")
    return _save(fig, out_path, dpi)


def plot_volcano_adj_p(
    de: pd.DataFrame,
    out_path: Path,
    *,
    log2fc_col: str = "log2FC",
    adj_p_col: str = "adj_p",
    p_cutoff: float = 0.05,
    abs_log2_fc_cutoff: float = 0.7,
    label: str = "treatment − control",
    dpi: int = 150,
) -> Path:
    x = de[log2fc_col].astype(float)
    p = de[adj_p_col].astype(float).clip(lower=1e-300)
    y = -np.log10(p)
    sig = (p < p_cutoff) & (x.abs() > abs_log2_fc_cutoff)
    fig, ax = plt.subplots(figsize=(6.5, 5))
    ax.scatter(x[~sig], y[~sig], s=8, c="#b0b0b0", alpha=0.5, linewidths=0, label="ns")
    ax.scatter(x[sig], y[sig], s=12, c="#d62728", alpha=0.7, linewidths=0, label="significant")
    ax.axhline(-np.log10(p_cutoff), ls="--", color="#666666", lw=0.9)
    ax.axvline(abs_log2_fc_cutoff, ls="--", color="#666666", lw=0.9)
    ax.axvline(-abs_log2_fc_cutoff, ls="--", color="#666666", lw=0.9)
    ax.set_xlabel(f"log2FC ({label})")
    ax.set_ylabel("-log10(adj p)")
    ax.set_title("Volcano — BH-adjusted p")
    ax.legend(frameon=False, loc="best")
    return _save(fig, out_path, dpi)


def qc_conclusions(
    wide: pd.DataFrame,
    sample_cols: list[str],
) -> dict:
    miss = wide[sample_cols].isna().mean()
    mean_miss = float(miss.mean())
    max_miss = float(miss.max())
    notes = []
    severity = "ok"
    if max_miss >= 0.5:
        severity = "high"
        notes.append(f"At least one sample has ≥50% missingness (max={max_miss:.2f}).")
    elif max_miss >= 0.35 or mean_miss >= 0.35:
        severity = "moderate"
        notes.append(
            f"Elevated missingness (mean={mean_miss:.2f}, max={max_miss:.2f})."
        )
    else:
        notes.append(f"Missingness looks usable (mean={mean_miss:.2f}, max={max_miss:.2f}).")

    vals = wide[sample_cols].to_numpy(dtype=float).ravel()
    vals = vals[np.isfinite(vals) & (vals > 0)]
    if vals.size:
        log10 = np.log10(vals)
        notes.append(
            f"Intensity log10 range [{log10.min():.2f}, {log10.max():.2f}], "
            f"median={np.median(log10):.2f}."
        )
    return {
        "severity": severity,
        "mean_missing_fraction": mean_miss,
        "max_missing_fraction": max_miss,
        "notes": notes,
    }
