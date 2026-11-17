"""Visualization stage driven by viz.yaml (+ analysis artifacts)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from close_loop_run.config import deep_get
from close_loop_run.viz.plots import (
    plot_intensity_box,
    plot_intensity_hist,
    plot_missingness,
    plot_volcano_adj_p,
    qc_conclusions,
)


def _resolve_inputs(viz: dict[str, Any], analysis_result: dict[str, Any] | None) -> dict[str, Path]:
    inputs = viz.get("inputs") or {}
    paths = {
        "abundance_wide": inputs.get("abundance_wide"),
        "annotation": inputs.get("annotation"),
        "contrast_table": inputs.get("contrast_table"),
    }
    if analysis_result:
        paths["abundance_wide"] = paths["abundance_wide"] or analysis_result.get("abundance_wide")
        paths["annotation"] = paths["annotation"] or analysis_result.get("annotation")
        paths["contrast_table"] = paths["contrast_table"] or analysis_result.get("contrast_table")
    missing = [k for k, v in paths.items() if not v]
    if missing:
        raise ValueError(f"viz inputs missing: {missing}")
    return {k: Path(v) for k, v in paths.items()}


def run_viz(
    viz: dict[str, Any],
    *,
    analysis_result: dict[str, Any] | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    out = Path(out_dir or viz.get("output_dir") or "runs/latest/viz")
    out.mkdir(parents=True, exist_ok=True)
    qc_dir = out / "qc"
    de_dir = out / "de"
    go_dir = out / "go"
    report_dir = out / "report"
    for d in (qc_dir, de_dir, go_dir, report_dir):
        d.mkdir(parents=True, exist_ok=True)

    paths = _resolve_inputs(viz, analysis_result)
    wide = pd.read_csv(paths["abundance_wide"])
    ann = pd.read_csv(paths["annotation"], sep="\t") if paths["annotation"].suffix in {".tsv", ".txt"} else pd.read_csv(paths["annotation"])
    de = pd.read_csv(paths["contrast_table"])

    protein_col = deep_get(viz, "inputs", "protein_id_column", default="Protein ID")
    if protein_col not in de.columns:
        for cand in ("Protein ID", "Protein", "protein"):
            if cand in de.columns:
                protein_col = cand
                break
    log2fc_col = deep_get(viz, "inputs", "log2fc_column", default="log2FC")
    adj_p_col = deep_get(viz, "inputs", "adj_p_column", default="adj_p")
    p_col = deep_get(viz, "inputs", "p_value_column", default="p_value")

    sample_cols = [c for c in wide.columns if c != "Protein"]
    plots = viz.get("plots") or {}
    exports = viz.get("exports") or {}
    dpi = int(exports.get("dpi", 150))
    artifacts: dict[str, str] = {}

    if plots.get("qc_missingness", True):
        p = plot_missingness(wide, sample_cols, ann, qc_dir / "missingness.png", dpi=dpi)
        artifacts["qc.missingness"] = str(p)
        miss_tbl = wide[sample_cols].isna().mean().rename("missing_fraction").reset_index()
        miss_tbl.columns = ["sample", "missing_fraction"]
        miss_csv = qc_dir / "missingness.csv"
        miss_tbl.to_csv(miss_csv, index=False)
        artifacts["qc.missingness_csv"] = str(miss_csv)

    if plots.get("qc_intensity_hist", True):
        p = plot_intensity_hist(wide, sample_cols, qc_dir / "intensity_hist.png", dpi=dpi)
        artifacts["qc.intensity_hist"] = str(p)

    if plots.get("qc_intensity_box", True):
        p = plot_intensity_box(wide, sample_cols, qc_dir / "intensity_box.png", dpi=dpi)
        artifacts["qc.intensity_box"] = str(p)

    qc_summary = qc_conclusions(wide, sample_cols)
    if exports.get("write_qc_conclusions", True) or plots.get("qc_summary_text", True):
        qc_json = qc_dir / "summary.json"
        qc_json.write_text(json.dumps(qc_summary, indent=2), encoding="utf-8")
        artifacts["qc.summary"] = str(qc_json)
        (qc_dir / "summary.md").write_text(
            "# QC summary\n\n"
            + f"Severity: **{qc_summary['severity']}**\n\n"
            + "\n".join(f"- {n}" for n in qc_summary["notes"])
            + "\n",
            encoding="utf-8",
        )

    thr = viz.get("thresholds") or {}
    p_cutoff = float(thr.get("p_cutoff", 0.05))
    fc_cut = float(thr.get("abs_log2_fc_cutoff", 0.7))
    contrast = viz.get("contrast") or {}
    label = contrast.get("direction") or f"{contrast.get('group_b', 'treatment')} - {contrast.get('group_a', 'control')}"

    if plots.get("volcano_adj_p", True):
        p = plot_volcano_adj_p(
            de,
            de_dir / "volcano_adj_p.png",
            log2fc_col=log2fc_col,
            adj_p_col=adj_p_col,
            p_cutoff=p_cutoff,
            abs_log2_fc_cutoff=fc_cut,
            label=label,
            dpi=dpi,
        )
        artifacts["de.volcano_adj_p"] = str(p)

    # significant table
    pvals = de[adj_p_col].astype(float) if thr.get("p_value_mode", "adjusted") == "adjusted" else de[p_col].astype(float)
    sig_mask = (pvals < p_cutoff) & (de[log2fc_col].astype(float).abs() > fc_cut)
    sig = de.loc[sig_mask].copy()
    sig = sig.sort_values(adj_p_col if adj_p_col in sig.columns else p_col)
    if exports.get("write_significant_table", True):
        sig_path = de_dir / "significant.tsv"
        sig.to_csv(sig_path, sep="\t", index=False)
        artifacts["de.sig_table"] = str(sig_path)

    n_ctrl = int((ann["condition"] == contrast.get("group_a", "control")).sum()) if "condition" in ann.columns else None
    n_treat = int((ann["condition"] == contrast.get("group_b", "treatment")).sum()) if "condition" in ann.columns else None
    de_summary = {
        "contrast_id": contrast.get("id"),
        "label": contrast.get("label"),
        "direction": label,
        "method": contrast.get("method", "welch_ttest_bh"),
        "n_proteins_plotted": int(len(de)),
        "n_significant": int(len(sig)),
        "p_cutoff": p_cutoff,
        "abs_log2_fc_cutoff": fc_cut,
        "n_group_a": n_ctrl,
        "n_group_b": n_treat,
        "group_a": contrast.get("group_a"),
        "group_b": contrast.get("group_b"),
    }
    de_summary_path = de_dir / "summary.json"
    de_summary_path.write_text(json.dumps(de_summary, indent=2), encoding="utf-8")
    artifacts["de.contrast_summary"] = str(de_summary_path)
    (de_dir / "summary.md").write_text(
        f"# Contrast summary\n\n"
        f"- Contrast: {label}\n"
        f"- Proteins plotted: {de_summary['n_proteins_plotted']}\n"
        f"- Significant (adj_p < {p_cutoff}, |log2FC| > {fc_cut}): **{de_summary['n_significant']}**\n"
        f"- Method: {de_summary['method']}\n",
        encoding="utf-8",
    )

    # GO skip for smoke
    go_cfg = viz.get("go") or {}
    if go_cfg.get("enabled") and go_cfg.get("mode") not in (None, "skip"):
        (go_dir / "NOTE.md").write_text(
            "GO enrichment requested but not implemented in smoke runner; skipped.\n",
            encoding="utf-8",
        )
    else:
        (go_dir / "SKIPPED.md").write_text(
            "GO enrichment skipped for smoke (go.mode=skip / disabled).\n",
            encoding="utf-8",
        )
        artifacts["go.skipped"] = str(go_dir / "SKIPPED.md")

    if exports.get("write_report_index", True):
        lines = [
            f"# Run report — {viz.get('run_id', 'smoke')}",
            "",
            "## Differential",
            f"- Significant proteins: **{de_summary['n_significant']}** "
            f"(adj_p < {p_cutoff}, |log2FC| > {fc_cut})",
            f"- Volcano: `{artifacts.get('de.volcano_adj_p', '')}`",
            f"- Significant table: `{artifacts.get('de.sig_table', '')}`",
            "",
            "## QC",
            f"- Severity: **{qc_summary['severity']}**",
            *[f"- {n}" for n in qc_summary["notes"]],
            "",
            "## Artifacts",
        ]
        for k, v in artifacts.items():
            lines.append(f"- `{k}`: `{v}`")
        report_path = report_dir / "index.md"
        report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        artifacts["report.index"] = str(report_path)

    manifest = {"artifacts": artifacts, "de_summary": de_summary, "qc_summary": qc_summary}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return {"out_dir": out, "artifacts": artifacts, "de_summary": de_summary, "qc_summary": qc_summary}
