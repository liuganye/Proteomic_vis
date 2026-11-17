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


def welch_differential(
    log2_matrix: pd.DataFrame,
    control_cols: list[str],
    treatment_cols: list[str],
    *,
    min_n: int = 2,
    alpha: float = 0.05,
) -> pd.DataFrame:
    se_df = welch_se_delta(log2_matrix, control_cols, treatment_cols, min_n=min_n)
    p_vals = []
    for _, row in se_df.iterrows():
        if not np.isfinite(row["se_delta"]) or row["se_delta"] == 0:
            # fall back to scipy if possible
            pass
        n_a = int(row["n_control"])
        n_b = int(row["n_treatment"])
        if n_a < min_n or n_b < min_n:
            p_vals.append(np.nan)
            continue
        # reconstruct vectors from means/vars is insufficient for t; recompute from matrix
        p_vals.append(np.nan)

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
        # scipy welch
        try:
            res = stats.ttest_ind(a, b, equal_var=False, alternative="two-sided")
            p_list.append(float(res.pvalue))
        except Exception:
            p_list.append(np.nan)

    se_df["p_value"] = p_list
    se_df["adj_p"] = bh_fdr(np.asarray(p_list, dtype=float))
    se_df["significant"] = (se_df["adj_p"] < alpha) & se_df["adj_p"].notna()
    return se_df


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
