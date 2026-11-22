"""NaN-freq, abundance, Welch SE(Δ), Welch+BH differential testing."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats


def nan_frequency(matrix: pd.DataFrame, cols: list[str]) -> pd.Series:
    sub = matrix[cols]
    return sub.isna().mean(axis=1)


def abundance_means(
    log_matrix: pd.DataFrame,
    cols: list[str],
    *,
    log_kind: str = "log2",
) -> pd.DataFrame:
    """
    Per-protein mean abundance over contrast columns.
    log_kind=log10_mean converts log2 values to log10 mean; log2 keeps log2 mean.
    """
    means_log2 = log_matrix[cols].mean(axis=1, skipna=True)
    out = pd.DataFrame({"Protein": log_matrix["Protein"], "abundance_log2_mean": means_log2})
    if log_kind in ("log10_mean", "log10"):
        out["abundance_log10_mean"] = means_log2 / np.log2(10.0)
    return out


def welch_se_delta(
    log2_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    min_n: int = 2,
) -> pd.DataFrame:
    """SE of (control_mean - treatment_mean) with Welch variance."""
    ctrl = log2_matrix[control_cols].to_numpy(dtype=float)
    treat = log2_matrix[treatment_cols].to_numpy(dtype=float)
    rows = []
    for i, protein in enumerate(log2_matrix["Protein"]):
        a = ctrl[i]
        b = treat[i]
        a = a[np.isfinite(a)]
        b = b[np.isfinite(b)]
        n_a, n_b = a.size, b.size
        if n_a < min_n or n_b < min_n:
            rows.append(
                {
                    "Protein": protein,
                    "mean_control": np.nan,
                    "mean_treatment": np.nan,
                    "delta": np.nan,
                    "se_delta": np.nan,
                    "var_control": np.nan,
                    "var_treatment": np.nan,
                    "n_control": n_a,
                    "n_treatment": n_b,
                }
            )
            continue
        mean_a = float(np.mean(a))
        mean_b = float(np.mean(b))
        var_a = float(np.var(a, ddof=1))
        var_b = float(np.var(b, ddof=1))
        se = float(np.sqrt(var_a / n_a + var_b / n_b))
        rows.append(
            {
                "Protein": protein,
                "mean_control": mean_a,
                "mean_treatment": mean_b,
                "delta": mean_a - mean_b,  # control_minus_treatment
                "log2FC": mean_b - mean_a,  # treatment - control (viz convention)
                "se_delta": se,
                "var_control": var_a,
                "var_treatment": var_b,
                "n_control": n_a,
                "n_treatment": n_b,
            }
        )
    return pd.DataFrame(rows)


def bh_fdr(p_values: np.ndarray) -> np.ndarray:
    p = np.asarray(p_values, dtype=float)
    n = p.size
    q = np.full(n, np.nan, dtype=float)
    valid = np.isfinite(p)
    if not valid.any():
        return q
    pv = p[valid]
    order = np.argsort(pv)
    ranked = pv[order]
    m = ranked.size
    adj = ranked * m / (np.arange(1, m + 1))
    # enforce monotonicity from the back
    adj = np.minimum.accumulate(adj[::-1])[::-1]
    adj = np.clip(adj, 0, 1)
    out = np.empty(m, dtype=float)
    out[order] = adj
    q[valid] = out
    return q


def median_center_samples(log2_matrix: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Subtract each sample column's median (finite values) — common LFQ/iBAQ centering."""
    out = log2_matrix.copy()
    for col in cols:
        vals = out[col].to_numpy(dtype=float)
        med = np.nanmedian(vals)
        if np.isfinite(med):
            out[col] = vals - med
    return out


def welch_differential(
    log2_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    min_n: int = 2,
    alpha: float = 0.05,
) -> pd.DataFrame:
    se_df = welch_se_delta(log2_matrix, control_cols, treatment_cols, min_n=min_n)
    ctrl = log2_matrix[control_cols].to_numpy(dtype=float)
    treat = log2_matrix[treatment_cols].to_numpy(dtype=float)
    p_list = []
    for i in range(len(log2_matrix)):
        a = ctrl[i]
        b = treat[i]
        a = a[np.isfinite(a)]
        b = b[np.isfinite(b)]
        if a.size < min_n or b.size < min_n:
            p_list.append(np.nan)
            continue
        try:
            res = stats.ttest_ind(a, b, equal_var=False, alternative="two-sided")
            p_list.append(float(res.pvalue))
        except Exception:
            p_list.append(np.nan)

    se_df["p_value"] = p_list
    se_df["adj_p"] = bh_fdr(np.asarray(p_list, dtype=float))
    se_df["significant"] = (se_df["adj_p"] < alpha) & se_df["adj_p"].notna()
    se_df["test"] = "welch_ttest_two_sided"
    return se_df


def limma_like_differential(
    log2_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    min_n: int = 2,
    alpha: float = 0.05,
    df_prior: float | None = None,
) -> pd.DataFrame:
    """
    Empirical-Bayes moderated two-sample t-test (limma-like, equal-variance pool).

    Not a full R limma port, but shrinks residual variances toward a robust prior so
    small-n proteomics contrasts recover more DAPs than plain Welch — closer to
    ProStaR/limma behavior used in some papers (e.g. pair-02).
    """
    se_df = welch_se_delta(log2_matrix, control_cols, treatment_cols, min_n=min_n)
    ctrl = log2_matrix[control_cols].to_numpy(dtype=float)
    treat = log2_matrix[treatment_cols].to_numpy(dtype=float)

    n = len(log2_matrix)
    mean_a = np.full(n, np.nan)
    mean_b = np.full(n, np.nan)
    s2 = np.full(n, np.nan)
    df = np.full(n, np.nan)
    n_a_arr = np.zeros(n, dtype=int)
    n_b_arr = np.zeros(n, dtype=int)

    for i in range(n):
        a = ctrl[i][np.isfinite(ctrl[i])]
        b = treat[i][np.isfinite(treat[i])]
        n_a_arr[i], n_b_arr[i] = a.size, b.size
        if a.size < min_n or b.size < min_n:
            continue
        mean_a[i] = float(np.mean(a))
        mean_b[i] = float(np.mean(b))
        # pooled residual variance (equal-variance limma-style for 2 groups)
        if a.size + b.size > 2:
            ss = float(np.sum((a - mean_a[i]) ** 2) + np.sum((b - mean_b[i]) ** 2))
            dfi = a.size + b.size - 2
            df[i] = dfi
            s2[i] = ss / dfi if dfi > 0 else np.nan

    valid = np.isfinite(s2) & (s2 > 0) & np.isfinite(df) & (df > 0)
    if valid.sum() >= 10:
        # robust prior variance + df (Smyth-inspired moment approx)
        log_s2 = np.log(s2[valid])
        s2_prior = float(np.exp(np.median(log_s2)))
        # df_prior: use configured or a conservative default scaled by n proteins
        if df_prior is None:
            # larger squeeze when few proteins have high variance scatter
            mad = float(np.median(np.abs(log_s2 - np.median(log_s2)))) + 1e-6
            df_prior = float(np.clip(2.0 / (mad**2), 2.0, 30.0))
        s2_mod = (df * s2 + df_prior * s2_prior) / (df + df_prior)
    else:
        s2_prior = float(np.nanmedian(s2[np.isfinite(s2)])) if np.isfinite(s2).any() else 1.0
        df_prior = float(df_prior or 4.0)
        s2_mod = s2.copy()

    p_list = []
    t_list = []
    for i in range(n):
        if not np.isfinite(s2_mod[i]) or n_a_arr[i] < min_n or n_b_arr[i] < min_n:
            p_list.append(np.nan)
            t_list.append(np.nan)
            continue
        se = float(np.sqrt(s2_mod[i] * (1.0 / n_a_arr[i] + 1.0 / n_b_arr[i])))
        if se <= 0 or not np.isfinite(se):
            p_list.append(np.nan)
            t_list.append(np.nan)
            continue
        t_stat = (mean_b[i] - mean_a[i]) / se
        dfi = float(df[i] + (df_prior or 0.0))
        p = float(2 * stats.t.sf(abs(t_stat), dfi))
        p_list.append(p)
        t_list.append(float(t_stat))
        # refresh SE/log2FC from moderated path for consistency
        se_df.loc[i, "se_delta"] = se
        se_df.loc[i, "log2FC"] = mean_b[i] - mean_a[i]
        se_df.loc[i, "delta"] = mean_a[i] - mean_b[i]
        se_df.loc[i, "mean_control"] = mean_a[i]
        se_df.loc[i, "mean_treatment"] = mean_b[i]

    se_df["t_moderated"] = t_list
    se_df["p_value"] = p_list
    se_df["adj_p"] = bh_fdr(np.asarray(p_list, dtype=float))
    se_df["significant"] = (se_df["adj_p"] < alpha) & se_df["adj_p"].notna()
    se_df["test"] = "limma_like_moderated_ttest"
    se_df.attrs["s2_prior"] = s2_prior
    se_df.attrs["df_prior"] = df_prior
    return se_df


def run_differential(
    log2_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    test: str = "welch_ttest_two_sided",
    min_n: int = 2,
    alpha: float = 0.05,
    df_prior: float | None = None,
) -> pd.DataFrame:
    t = (test or "welch").lower()
    if t in (
        "limma_like_moderated_ttest",
        "limma_like",
        "limma",
        "moderated_ttest",
        "ebayes",
    ):
        return limma_like_differential(
            log2_matrix,
            control_cols,
            treatment_cols,
            min_n=min_n,
            alpha=alpha,
            df_prior=df_prior,
        )
    return welch_differential(
        log2_matrix, control_cols, treatment_cols, min_n=min_n, alpha=alpha
    )


def _organism_ratio_stats(fc: pd.Series) -> dict:
    fc = fc.astype(float)
    fc = fc[np.isfinite(fc)]
    if fc.empty:
        return {}
    folds = np.power(2.0, fc.to_numpy())
    return {
        "n": int(fc.size),
        "median_log2FC": float(np.median(fc)),
        "median_fold_treatment_over_control": float(np.median(folds)),
        "frac_abs_log2FC_lt_0.5": float(np.mean(np.abs(fc) < 0.5)),
        "frac_log2FC_within_0.5_of_log2_3": float(
            np.mean(np.abs(fc - np.log2(3.0)) <= 0.5)
        ),
        "mad_log2FC": float(np.median(np.abs(fc - np.median(fc)))),
    }


def species_ratio_diagnostics(
    de: pd.DataFrame,
    *,
    organism_col: str = "organism_inferred",
    log2fc_col: str = "log2FC",
    abundance_col: str = "abundance_log2_mean",
    abundance_tertiles: bool = False,
) -> dict:
    """Median fold ratios stratified by inferred organism (pair-01 style)."""
    if organism_col not in de.columns:
        return {"enabled": False, "reason": f"missing {organism_col}"}
    out: dict = {"enabled": True, "by_organism": {}, "abundance_tertiles": None}
    for org, sub in de.groupby(organism_col):
        stats = _organism_ratio_stats(sub[log2fc_col])
        if stats:
            out["by_organism"][str(org)] = stats

    # Optional abundance × organism precision view (paper claim: better at high abundance)
    if abundance_tertiles and abundance_col in de.columns:
        work = de[[organism_col, log2fc_col, abundance_col]].copy()
        work = work[np.isfinite(work[abundance_col].astype(float))]
        tert: dict = {}
        try:
            work["abund_tertile"] = pd.qcut(
                work[abundance_col].astype(float), q=3, labels=["low", "mid", "high"], duplicates="drop"
            )
        except ValueError:
            out["abundance_tertiles"] = {"enabled": False, "reason": "qcut_failed"}
            return out
        for (org, band), sub in work.groupby([organism_col, "abund_tertile"], observed=True):
            key = f"{org}::{band}"
            stats = _organism_ratio_stats(sub[log2fc_col])
            if stats:
                tert[key] = stats
        # Precision proxy: MAD of log2FC should shrink for E. coli at high abundance if claim holds
        out["abundance_tertiles"] = {
            "enabled": True,
            "by_organism_tertile": tert,
            "note": "mad_log2FC is a precision proxy; median_fold should approach 3 (E. coli) / 1 (human) at high abundance if MaxLFQ recovers ratios.",
        }
    return out


def theme_direction_summary(
    de: pd.DataFrame,
    *,
    theme_col: str = "theme_keywords",
    log2fc_col: str = "log2FC",
    adj_p_col: str = "adj_p",
    alpha: float = 0.05,
    abs_log2_fc_cutoff: float = 0.585,
) -> dict:
    """Per-theme up/down counts among significant proteins (pair-02 style)."""
    if theme_col not in de.columns:
        return {"enabled": False, "reason": f"missing {theme_col}"}
    mask = (
        de[adj_p_col].notna()
        & (de[adj_p_col] < alpha)
        & (de[log2fc_col].abs() > abs_log2_fc_cutoff)
    )
    sig = de.loc[mask]
    by_theme: dict = {}
    for _, row in sig.iterrows():
        themes = [t for t in str(row.get(theme_col) or "").split(";") if t]
        fc = float(row[log2fc_col])
        for t in themes:
            slot = by_theme.setdefault(t, {"n": 0, "n_up": 0, "n_down": 0, "examples": []})
            slot["n"] += 1
            if fc > 0:
                slot["n_up"] += 1
            elif fc < 0:
                slot["n_down"] += 1
            if len(slot["examples"]) < 3:
                slot["examples"].append(
                    {
                        "protein": str(row.get("Protein", row.get("Protein ID", ""))),
                        "log2FC": fc,
                        "adj_p": float(row[adj_p_col]),
                    }
                )
    return {
        "enabled": True,
        "alpha": alpha,
        "abs_log2_fc_cutoff": abs_log2_fc_cutoff,
        "by_theme": by_theme,
    }


def dap_threshold_grid(
    de: pd.DataFrame,
    *,
    log2fc_col: str = "log2FC",
    adj_p_col: str = "adj_p",
    grid: list[dict] | None = None,
) -> dict:
    """Report DAP counts at several (alpha, |log2FC|) cuts for Interpreter/Judge."""
    if log2fc_col not in de.columns or adj_p_col not in de.columns:
        return {"enabled": False, "reason": "missing DE columns"}
    grid = grid or [
        {"alpha": 0.05, "abs_log2_fc_cutoff": 0.585, "label": "primary_1.5fold"},
        {"alpha": 0.05, "abs_log2_fc_cutoff": 0.0, "label": "q_only"},
        {"alpha": 0.1, "abs_log2_fc_cutoff": 0.585, "label": "exploratory_q0.1_1.5fold"},
        {"alpha": 0.05, "abs_log2_fc_cutoff": 1.0, "label": "strict_2fold"},
    ]
    rows = []
    tested = de[de[adj_p_col].notna() & de[log2fc_col].notna()]
    for g in grid:
        a = float(g["alpha"])
        fc = float(g["abs_log2_fc_cutoff"])
        mask = tested[adj_p_col] < a
        if fc > 0:
            mask = mask & (tested[log2fc_col].abs() > fc)
        sub = tested.loc[mask]
        rows.append(
            {
                "label": g.get("label") or f"q<{a}_|fc|>{fc}",
                "alpha": a,
                "abs_log2_fc_cutoff": fc,
                "n": int(len(sub)),
                "n_up": int((sub[log2fc_col] > 0).sum()),
                "n_down": int((sub[log2fc_col] < 0).sum()),
            }
        )
    return {"enabled": True, "n_tested": int(len(tested)), "grid": rows}


def fraction_changed_diagnostic(
    de: pd.DataFrame,
    *,
    log2fc_col: str = "log2FC",
    adj_p_col: str = "adj_p",
    fold_cutoff: float = 1.5,
    alpha: float = 0.05,
) -> dict:
    """
    Fraction of tested proteins exceeding |fold| and BH q (pair-03 'most differ' claim).
    """
    if log2fc_col not in de.columns or adj_p_col not in de.columns:
        return {"enabled": False, "reason": "missing DE columns"}
    tested = de[de[adj_p_col].notna() & de[log2fc_col].notna()].copy()
    n = int(len(tested))
    if n == 0:
        return {"enabled": False, "reason": "no_tested"}
    abs_l2 = float(np.log2(fold_cutoff))
    fold_mask = tested[log2fc_col].abs() >= abs_l2
    q_mask = tested[adj_p_col] < alpha
    both = fold_mask & q_mask
    n_fold = int(fold_mask.sum())
    n_both = int(both.sum())
    return {
        "enabled": True,
        "n_tested": n,
        "fold_cutoff": fold_cutoff,
        "abs_log2_fc_cutoff": abs_l2,
        "alpha": alpha,
        "n_abs_fold_ge_cutoff": n_fold,
        "frac_abs_fold_ge_cutoff": float(n_fold / n),
        "n_abs_fold_and_q": n_both,
        "frac_abs_fold_and_q": float(n_both / n),
        "n_unchanged_at_fold_cutoff": int((~fold_mask).sum()),
        "note": "Paper-style 'unchanged at 1.5-fold' ≈ n_tested - n_abs_fold_ge_cutoff (ignoring q).",
    }


def group_load_diagnostics(
    linear_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    intensity_mode: str = "lfq",
) -> dict:
    """
    Sample/group total secreted (or cellular) protein load from linear intensities.

    Useful for secretome papers that report bulk iBAQ/LFQ load ratios
    (e.g. TNF-α ~3× at 48 h) independent of per-protein DE.
    """
    missing = [c for c in control_cols + treatment_cols if c not in linear_matrix.columns]
    if missing:
        return {"enabled": False, "reason": f"missing columns: {missing}"}

    per_sample: dict[str, float] = {}
    for col in control_cols + treatment_cols:
        vals = pd.to_numeric(linear_matrix[col], errors="coerce").to_numpy(dtype=float)
        vals = vals[np.isfinite(vals) & (vals > 0)]
        per_sample[col] = float(np.sum(vals)) if vals.size else 0.0

    ctrl_loads = [per_sample[c] for c in control_cols]
    treat_loads = [per_sample[c] for c in treatment_cols]
    mean_ctrl = float(np.mean(ctrl_loads)) if ctrl_loads else float("nan")
    mean_treat = float(np.mean(treat_loads)) if treat_loads else float("nan")
    ratio = (
        float(mean_treat / mean_ctrl)
        if mean_ctrl and np.isfinite(mean_ctrl) and mean_ctrl > 0
        else float("nan")
    )
    return {
        "enabled": True,
        "intensity_mode": intensity_mode,
        "per_sample_total": per_sample,
        "mean_control_total": mean_ctrl,
        "mean_treatment_total": mean_treat,
        "load_ratio_treatment_over_control": ratio,
        "n_control_samples": len(control_cols),
        "n_treatment_samples": len(treatment_cols),
    }


def se_low_tech_bio(se_df: pd.DataFrame, tertiles: int = 3) -> pd.DataFrame:
    """Optional cheap tech/bio: SE-low tertile = technical (fallback rule)."""
    out = se_df.copy()
    se = out["se_delta"]
    valid = se.notna()
    out["se_tertile"] = np.nan
    out["nan_type_se"] = pd.NA
    if valid.sum() < tertiles:
        return out
    try:
        cats = pd.qcut(se[valid], q=tertiles, labels=False, duplicates="drop")
    except ValueError:
        return out
    out.loc[valid, "se_tertile"] = cats.astype(float)
    # lowest SE tertile = technical
    out.loc[valid, "nan_type_se"] = np.where(cats == 0, "technical", "biological")
    return out
