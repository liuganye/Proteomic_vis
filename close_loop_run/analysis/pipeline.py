"""Smoke analysis pipeline: ingest → NaN → impute → abundance → SE → DE → summaries."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from close_loop_run.analysis.impute import impute_methods
from close_loop_run.analysis.ingest import ingest_matrix
from close_loop_run.analysis.stats import (
    abundance_means,
    nan_frequency,
    se_low_tech_bio,
    welch_differential,
)
from close_loop_run.config import deep_get


def run_analysis(cfg: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    analysis_dir = out_dir / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    ingested = ingest_matrix(cfg, out_dir)
    matrix: pd.DataFrame = ingested["matrix"]
    contrast_cols: list[str] = ingested["contrast_cols"]
    control_cols: list[str] = ingested["control_cols"]
    treatment_cols: list[str] = ingested["treatment_cols"]
    sample_cols: list[str] = ingested["sample_cols"]

    if len(control_cols) < 2 or len(treatment_cols) < 2:
        raise ValueError(
            f"Need ≥2 samples per arm; got control={control_cols}, treatment={treatment_cols}"
        )

    # Step 1 — NaN-freq on linear (pre-impute) contrast columns
    nan_freq = nan_frequency(matrix, contrast_cols)
    nan_table = pd.DataFrame({"Protein": matrix["Protein"], "nan_freq": nan_freq})
    nan_path = analysis_dir / "nan_freq.csv"
    nan_table.to_csv(nan_path, index=False)

    # Step 2 — Impute
    imp_cfg = cfg.get("imputation", {}) or {}
    methods = imp_cfg.get("methods") or ["perseus_left_censored"]
    perseus = imp_cfg.get("perseus") or {}
    imputed = impute_methods(
        matrix,
        sample_cols,
        methods,
        shift=float(perseus.get("shift", 1.8)),
        width=float(perseus.get("width", 0.3)),
        seed=int(imp_cfg.get("seed", 42)),
    )
    primary_method = (
        "perseus_left_censored"
        if "perseus_left_censored" in imputed
        else next(iter(imputed))
    )
    log2 = imputed[primary_method]
    log2_path = analysis_dir / f"abundance_log2_{primary_method}.csv"
    log2.to_csv(log2_path, index=False)

    # Step 3 — Abundance
    abund_cfg = cfg.get("abundance", {}) or {}
    abund = abundance_means(
        log2, contrast_cols, log_kind=abund_cfg.get("log", "log10_mean")
    )
    abund = abund.merge(nan_table, on="Protein", how="left")
    abund_path = analysis_dir / "abundance.csv"
    abund.to_csv(abund_path, index=False)

    # Steps 4–5 — SE + DE
    min_n = int(deep_get(cfg, "samples", "min_n_per_arm", default=2))
    alpha = float(deep_get(cfg, "differential", "alpha", default=0.05))
    de = welch_differential(
        log2, control_cols, treatment_cols, min_n=min_n, alpha=alpha
    )
    de = de.merge(abund, on="Protein", how="left")

    # Step 6 — optional tech/bio
    tech_cfg = cfg.get("tech_bio", {}) or {}
    if tech_cfg.get("enabled"):
        tertiles = int(deep_get(cfg, "se", "tertiles", default=3))
        de = se_low_tech_bio(de, tertiles=tertiles)
        tech_path = analysis_dir / "tech_bio_labels.csv"
        de[["Protein", "se_delta", "se_tertile", "nan_type_se"]].to_csv(tech_path, index=False)
    else:
        tech_path = None

    de_path = analysis_dir / "contrast_welch_bh.csv"
    # viz-friendly columns
    de_export = de.rename(columns={"Protein": "Protein ID"})
    de_export["Gene"] = de_export["Protein ID"].astype(str).str.split("|").str[-1]
    de_export["method"] = "welch_ttest_bh"
    de_export.to_csv(de_path, index=False)

    sig = de_export[de_export["significant"] == True].copy()  # noqa: E712
    sig = sig.sort_values("adj_p", ascending=True)
    sig_path = analysis_dir / "significant_proteins.csv"
    sig.to_csv(sig_path, index=False)

    n_tested = int(de_export["p_value"].notna().sum())
    n_sig = int(sig.shape[0])
    metrics = {
        "run_id": deep_get(cfg, "meta", "run_id"),
        "dataset": deep_get(cfg, "dataset", "name"),
        "n_proteins": ingested["n_proteins"],
        "n_tested": n_tested,
        "n_significant_q_lt_alpha": n_sig,
        "alpha": alpha,
        "imputation": primary_method,
        "control_cols": control_cols,
        "treatment_cols": treatment_cols,
        "control_label": ingested["control_label"],
        "treatment_label": ingested["treatment_label"],
        "mean_nan_freq": float(nan_freq.mean()),
        "median_abs_log2FC_sig": float(sig["log2FC"].abs().median()) if n_sig else None,
        "top_significant": [
            {
                "protein": str(r["Protein ID"]),
                "log2FC": float(r["log2FC"]),
                "adj_p": float(r["adj_p"]),
            }
            for _, r in sig.head(20).iterrows()
        ],
    }
    metrics_path = analysis_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    summary_lines = [
        f"# Analysis summary — {metrics.get('dataset') or metrics.get('run_id')}",
        "",
        f"- Proteins after contaminant filter: **{metrics['n_proteins']}**",
        f"- Tested (Welch, ≥{min_n}/arm): **{n_tested}**",
        f"- Significant (BH q < {alpha}): **{n_sig}**",
        f"- Imputation: `{primary_method}`",
        f"- Contrast: `{ingested['treatment_label']}` − `{ingested['control_label']}` "
        f"(log2FC = treatment − control)",
        f"- Mean NaN-freq (contrast cols): {metrics['mean_nan_freq']:.3f}",
        "",
        "## Top significant proteins",
        "",
    ]
    if n_sig == 0:
        summary_lines.append("_None at current thresholds._")
    else:
        summary_lines.append("| Protein | log2FC | adj_p |")
        summary_lines.append("| --- | ---: | ---: |")
        for item in metrics["top_significant"][:15]:
            summary_lines.append(
                f"| `{item['protein']}` | {item['log2FC']:.3f} | {item['adj_p']:.2e} |"
            )
    summary_path = analysis_dir / "summary.md"
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    return {
        "out_dir": out_dir,
        "analysis_dir": analysis_dir,
        "abundance_wide": ingested["wide_path"],
        "annotation": ingested["annotation_path"],
        "contrast_table": de_path,
        "significant_table": sig_path,
        "metrics": metrics,
        "metrics_path": metrics_path,
        "summary_path": summary_path,
        "log2_matrix_path": log2_path,
        "nan_freq_path": nan_path,
        "tech_bio_path": tech_path,
        "control_cols": control_cols,
        "treatment_cols": treatment_cols,
        "sample_cols": sample_cols,
        "primary_imputation": primary_method,
    }
