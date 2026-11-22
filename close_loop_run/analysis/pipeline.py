"""Smoke analysis pipeline: ingest → NaN → impute → abundance → SE → DE → summaries."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from close_loop_run.analysis.annotate import DEFAULT_THEME_KEYWORDS, build_annotation_frame
from close_loop_run.analysis.impute import impute_methods
from close_loop_run.analysis.ingest import ingest_matrix
from close_loop_run.analysis.ingest import _detect_intensity_columns, _filter_contaminants
from close_loop_run.analysis.stats import (
    abundance_means,
    dap_threshold_grid,
    fraction_changed_diagnostic,
    group_load_diagnostics,
    median_center_samples,
    nan_frequency,
    run_differential,
    se_low_tech_bio,
    species_ratio_diagnostics,
    theme_direction_summary,
)
from close_loop_run.config import deep_get


def _linear_matrix_for_load(
    cfg: dict[str, Any],
    *,
    intensity_mode: str,
    control_cols: list[str],
    treatment_cols: list[str],
) -> pd.DataFrame | None:
    """Re-resolve linear intensity columns for group-load (may differ from DE mode)."""
    ds = cfg.get("dataset", {}) or {}
    samples = cfg.get("samples", {}) or {}
    filters = cfg.get("filters", {}) or {}
    matrix_path = Path(ds["matrix_path"])
    fmt = (ds.get("format") or matrix_path.suffix.lstrip(".")).lower()
    sep = "\t" if fmt in ("tsv", "txt", "") else ","
    df = pd.read_csv(matrix_path, sep=sep, low_memory=False)
    protein_col = ds.get("protein_col") or "Majority protein IDs"
    if protein_col not in df.columns:
        for cand in ("Majority protein IDs", "Protein IDs", "Protein"):
            if cand in df.columns:
                protein_col = cand
                break
    column_groups = dict(samples.get("column_groups") or {})
    try:
        resolved = _detect_intensity_columns(
            df,
            column_groups,
            intensity_prefix=ds.get("intensity_prefix"),
            intensity_mode=intensity_mode,
        )
    except KeyError:
        return None
    df = _filter_contaminants(df, protein_col, filters.get("contam_filter", "maxquant_or_fragpipe"))
    out = df[[protein_col, *[resolved[k] for k in control_cols + treatment_cols]]].copy()
    rename = {protein_col: "Protein", **{resolved[k]: k for k in control_cols + treatment_cols}}
    out = out.rename(columns=rename)
    for col in control_cols + treatment_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce")
        if filters.get("zeros_as_nan", True):
            out.loc[out[col] <= 0, col] = pd.NA
    return out.groupby("Protein", as_index=False).max()


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

    # Annotation frame (gene / fasta / organism / themes)
    ann_cfg = cfg.get("annotation", {}) or {}
    theme_map = ann_cfg.get("theme_keywords") or DEFAULT_THEME_KEYWORDS
    genes = matrix["Gene"] if "Gene" in matrix.columns else None
    fasta = matrix["Fasta headers"] if "Fasta headers" in matrix.columns else None
    annot = build_annotation_frame(
        matrix["Protein"], genes=genes, fasta=fasta, theme_map=theme_map
    )
    # Prefer explicit Gene column values when present.
    # Keep the full semicolon-joined MaxQuant "Gene names" string so marker
    # panels can match secondary symbols (e.g. ACTA2 in ACTB;…;ACTA2 groups).
    if genes is not None:
        annot["Gene"] = [
            (str(g) if pd.notna(g) and str(g) not in ("", "nan") else a)
            for g, a in zip(genes.tolist(), annot["Gene"].tolist())
        ]
        annot["Gene_primary"] = [
            (str(g).split(";")[0] if pd.notna(g) and str(g) not in ("", "nan") else a)
            for g, a in zip(genes.tolist(), annot["Gene"].tolist())
        ]
    annot_path = analysis_dir / "protein_annotation.csv"
    annot.to_csv(annot_path, index=False)

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

    # Optional sample median centering (helps ratio recovery / batch-ish offsets)
    norm_cfg = cfg.get("normalization", {}) or {}
    if norm_cfg.get("median_center", False):
        log2 = median_center_samples(log2, sample_cols)
        primary_method = f"{primary_method}+median_center"

    log2_path = analysis_dir / "abundance_log2.csv"
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
    diff_cfg = cfg.get("differential", {}) or {}
    alpha = float(diff_cfg.get("alpha", 0.05))
    test_name = diff_cfg.get("test", "welch_ttest_two_sided")
    df_prior = diff_cfg.get("df_prior")
    de = run_differential(
        log2,
        control_cols,
        treatment_cols,
        test=test_name,
        min_n=min_n,
        alpha=alpha,
        df_prior=float(df_prior) if df_prior is not None else None,
    )
    de = de.merge(abund, on="Protein", how="left")
    de = de.merge(annot, on="Protein", how="left")

    # Step 6 — optional tech/bio
    tech_cfg = cfg.get("tech_bio", {}) or {}
    if tech_cfg.get("enabled"):
        tertiles = int(deep_get(cfg, "se", "tertiles", default=3))
        de = se_low_tech_bio(de, tertiles=tertiles)
        tech_path = analysis_dir / "tech_bio_labels.csv"
        de[["Protein", "se_delta", "se_tertile", "nan_type_se"]].to_csv(tech_path, index=False)
    else:
        tech_path = None

    # Species ratio diagnostics (pair-01)
    diag_cfg = cfg.get("diagnostics", {}) or {}
    species_diag = None
    if diag_cfg.get("species_ratios", False):
        species_diag = species_ratio_diagnostics(
            de,
            abundance_tertiles=bool(diag_cfg.get("species_ratio_abundance_tertiles", False)),
        )
        (analysis_dir / "species_ratio_diagnostics.json").write_text(
            json.dumps(species_diag, indent=2), encoding="utf-8"
        )

    # Group total-intensity load (pair-03 secretome bulk load; optional alt quant mode)
    group_load = None
    if diag_cfg.get("group_load", False):
        load_mode = str(
            diag_cfg.get("group_load_intensity_mode")
            or ingested.get("intensity_mode")
            or "lfq"
        )
        load_matrix = matrix
        if load_mode.lower() != str(ingested.get("intensity_mode", "lfq")).lower():
            alt = _linear_matrix_for_load(
                cfg,
                intensity_mode=load_mode,
                control_cols=control_cols,
                treatment_cols=treatment_cols,
            )
            if alt is not None:
                load_matrix = alt
        group_load = group_load_diagnostics(
            load_matrix,
            control_cols,
            treatment_cols,
            intensity_mode=load_mode,
        )
        (analysis_dir / "group_load_diagnostics.json").write_text(
            json.dumps(group_load, indent=2), encoding="utf-8"
        )

    theme_dir = None
    if diag_cfg.get("theme_direction", False):
        theme_dir = theme_direction_summary(
            de,
            alpha=float(diag_cfg.get("theme_direction_alpha", alpha)),
            abs_log2_fc_cutoff=float(diag_cfg.get("theme_direction_abs_log2_fc", 0.585)),
        )
        (analysis_dir / "theme_direction_summary.json").write_text(
            json.dumps(theme_dir, indent=2), encoding="utf-8"
        )

    frac_changed = None
    if diag_cfg.get("fraction_changed", False):
        frac_changed = fraction_changed_diagnostic(
            de,
            fold_cutoff=float(diag_cfg.get("fraction_changed_fold_cutoff", 1.5)),
            alpha=float(diag_cfg.get("fraction_changed_alpha", alpha)),
        )
        (analysis_dir / "fraction_changed_diagnostics.json").write_text(
            json.dumps(frac_changed, indent=2), encoding="utf-8"
        )

    dap_grid = None
    if diag_cfg.get("dap_threshold_grid", False):
        dap_grid = dap_threshold_grid(de, grid=diag_cfg.get("dap_threshold_grid_spec") or None)
        (analysis_dir / "dap_threshold_grid.json").write_text(
            json.dumps(dap_grid, indent=2), encoding="utf-8"
        )

    de_path = analysis_dir / "contrast_welch_bh.csv"
    de_export = de.rename(columns={"Protein": "Protein ID"})
    if "Gene" not in de_export.columns or de_export["Gene"].fillna("").eq("").all():
        de_export["Gene"] = de_export["Protein ID"].astype(str).str.split("|").str[-1]
    de_export["method"] = test_name
    de_export["quant"] = ingested.get("intensity_mode", "lfq")
    de_export.to_csv(de_path, index=False)

    sig = de_export[de_export["significant"] == True].copy()  # noqa: E712
    sig = sig.sort_values("adj_p", ascending=True)
    sig_path = analysis_dir / "significant_proteins.csv"
    sig.to_csv(sig_path, index=False)

    # Exploratory cut for sparse matrices (pair-02 style)
    explor = diff_cfg.get("exploratory") or {}
    explor_alpha = float(explor.get("alpha", 0.1))
    explor_fc = float(explor.get("abs_log2_fc_cutoff", 0.5))
    explor_mask = (
        de_export["adj_p"].notna()
        & (de_export["adj_p"] < explor_alpha)
        & (de_export["log2FC"].abs() > explor_fc)
    )
    explor_df = de_export.loc[explor_mask].sort_values("adj_p")
    explor_path = analysis_dir / "significant_exploratory.csv"
    explor_df.to_csv(explor_path, index=False)

    # Theme enrichment among significant (keyword hits)
    theme_summary = {}
    if "theme_keywords" in sig.columns and len(sig):
        for themes in sig["theme_keywords"].fillna(""):
            for t in str(themes).split(";"):
                if t:
                    theme_summary[t] = theme_summary.get(t, 0) + 1

    n_tested = int(de_export["p_value"].notna().sum())
    n_sig = int(sig.shape[0])
    n_up = int(((sig["log2FC"] > 0).sum()) if n_sig else 0)
    n_down = int(((sig["log2FC"] < 0).sum()) if n_sig else 0)
    metrics = {
        "run_id": deep_get(cfg, "meta", "run_id"),
        "dataset": deep_get(cfg, "dataset", "name"),
        "n_proteins": ingested["n_proteins"],
        "n_tested": n_tested,
        "n_significant_q_lt_alpha": n_sig,
        "n_significant_up": n_up,
        "n_significant_down": n_down,
        "n_significant_exploratory": int(len(explor_df)),
        "alpha": alpha,
        "exploratory_alpha": explor_alpha,
        "exploratory_abs_log2_fc_cutoff": explor_fc,
        "imputation": primary_method,
        "test": test_name,
        "quant": ingested.get("intensity_mode", "lfq"),
        "median_center": bool(norm_cfg.get("median_center", False)),
        "control_cols": control_cols,
        "treatment_cols": treatment_cols,
        "control_label": ingested["control_label"],
        "treatment_label": ingested["treatment_label"],
        "mean_nan_freq": float(nan_freq.mean()),
        "median_abs_log2FC_sig": float(sig["log2FC"].abs().median()) if n_sig else None,
        "theme_keyword_counts_among_sig": theme_summary,
        "species_ratio_diagnostics": species_diag,
        "group_load_diagnostics": group_load,
        "theme_direction_summary": theme_dir,
        "fraction_changed_diagnostics": frac_changed,
        "dap_threshold_grid": dap_grid,
        "top_significant": [
            {
                "protein": str(r["Protein ID"]),
                "gene": str(r.get("Gene", "")),
                "organism": str(r.get("organism_inferred", "")),
                "themes": str(r.get("theme_keywords", "")),
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
        f"- Quant columns: `{metrics['quant']}`",
        f"- Test: `{test_name}` (≥{min_n}/arm)",
        f"- Tested: **{n_tested}**",
        f"- Significant (BH q < {alpha}): **{n_sig}** ({n_up} up / {n_down} down)",
        f"- Exploratory (q < {explor_alpha}, |log2FC| > {explor_fc}): **{len(explor_df)}**",
        f"- Imputation/normalization: `{primary_method}`",
        f"- Contrast: `{ingested['treatment_label']}` − `{ingested['control_label']}` "
        f"(log2FC = treatment − control)",
        f"- Mean NaN-freq (contrast cols): {metrics['mean_nan_freq']:.3f}",
        "",
    ]
    if species_diag and species_diag.get("enabled"):
        summary_lines.append("## Species-stratified median ratios")
        summary_lines.append("")
        summary_lines.append("| Organism | n | median log2FC | median fold (treat/ctrl) | MAD log2FC |")
        summary_lines.append("| --- | ---: | ---: | ---: | ---: |")
        for org, st in species_diag.get("by_organism", {}).items():
            mad = st.get("mad_log2FC")
            mad_s = f"{mad:.3f}" if mad is not None else "—"
            summary_lines.append(
                f"| {org} | {st['n']} | {st['median_log2FC']:.3f} | "
                f"{st['median_fold_treatment_over_control']:.3f} | {mad_s} |"
            )
        summary_lines.append("")
        at = species_diag.get("abundance_tertiles") or {}
        if at.get("enabled"):
            summary_lines.append("## Species × abundance-tertile ratios")
            summary_lines.append("")
            summary_lines.append("| Organism::tertile | n | median fold | MAD log2FC |")
            summary_lines.append("| --- | ---: | ---: | ---: |")
            for key, st in sorted(at.get("by_organism_tertile", {}).items()):
                summary_lines.append(
                    f"| {key} | {st['n']} | {st['median_fold_treatment_over_control']:.3f} | "
                    f"{st.get('mad_log2FC', float('nan')):.3f} |"
                )
            summary_lines.append("")
    if theme_summary:
        summary_lines.append("## Theme keywords among significant")
        summary_lines.append("")
        for k, v in sorted(theme_summary.items(), key=lambda kv: -kv[1]):
            summary_lines.append(f"- `{k}`: {v}")
        summary_lines.append("")
    if group_load and group_load.get("enabled"):
        summary_lines.append("## Group total intensity load")
        summary_lines.append("")
        summary_lines.append(
            f"- Quant for load: `{group_load.get('intensity_mode')}`"
        )
        summary_lines.append(
            f"- Mean control total: **{group_load['mean_control_total']:.3e}**"
        )
        summary_lines.append(
            f"- Mean treatment total: **{group_load['mean_treatment_total']:.3e}**"
        )
        summary_lines.append(
            f"- Load ratio (treatment/control): **{group_load['load_ratio_treatment_over_control']:.3f}**"
        )
        summary_lines.append("")
    if theme_dir and theme_dir.get("enabled"):
        summary_lines.append("## Theme direction among significant")
        summary_lines.append("")
        summary_lines.append("| Theme | n | up | down |")
        summary_lines.append("| --- | ---: | ---: | ---: |")
        for k, st in sorted(theme_dir.get("by_theme", {}).items(), key=lambda kv: -kv[1]["n"]):
            summary_lines.append(f"| `{k}` | {st['n']} | {st['n_up']} | {st['n_down']} |")
        summary_lines.append("")
    if frac_changed and frac_changed.get("enabled"):
        summary_lines.append("## Fraction changed at fold cutoff")
        summary_lines.append("")
        summary_lines.append(
            f"- Tested: **{frac_changed['n_tested']}**; |fold|≥{frac_changed['fold_cutoff']}: "
            f"**{frac_changed['n_abs_fold_ge_cutoff']}** "
            f"({100*frac_changed['frac_abs_fold_ge_cutoff']:.1f}%)"
        )
        summary_lines.append(
            f"- Unchanged at fold cutoff: **{frac_changed['n_unchanged_at_fold_cutoff']}**"
        )
        summary_lines.append(
            f"- |fold|≥cutoff ∧ q<{frac_changed['alpha']}: "
            f"**{frac_changed['n_abs_fold_and_q']}** "
            f"({100*frac_changed['frac_abs_fold_and_q']:.1f}%)"
        )
        summary_lines.append("")
    if dap_grid and dap_grid.get("enabled"):
        summary_lines.append("## DAP counts at multiple thresholds")
        summary_lines.append("")
        summary_lines.append("| Label | alpha | |log2FC| cut | n | up | down |")
        summary_lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        for row in dap_grid.get("grid", []):
            summary_lines.append(
                f"| `{row['label']}` | {row['alpha']} | {row['abs_log2_fc_cutoff']} | "
                f"{row['n']} | {row['n_up']} | {row['n_down']} |"
            )
        summary_lines.append("")
    summary_lines.append("## Top significant proteins")
    summary_lines.append("")
    if n_sig == 0:
        summary_lines.append("_None at current thresholds._")
    else:
        summary_lines.append("| Protein | Gene | log2FC | adj_p | themes |")
        summary_lines.append("| --- | --- | ---: | ---: | --- |")
        for item in metrics["top_significant"][:15]:
            summary_lines.append(
                f"| `{item['protein']}` | {item['gene']} | {item['log2FC']:.3f} | "
                f"{item['adj_p']:.2e} | {item['themes']} |"
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
        "exploratory_table": explor_path,
        "protein_annotation": annot_path,
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
