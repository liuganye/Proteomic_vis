"""Perseus-style left-censored imputation and helpers."""

from __future__ import annotations

import numpy as np
import pandas as pd


def to_log2(matrix: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = matrix.copy()
    for col in cols:
        vals = out[col].astype(float)
        # already-log? treat positive linear intensities; zeros/neg already NaN
        out[col] = np.where(np.isfinite(vals) & (vals > 0), np.log2(vals), np.nan)
    return out


def perseus_left_censored(
    log2_matrix: pd.DataFrame,
    cols: list[str],
    *,
    shift: float = 1.8,
    width: float = 0.3,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Perseus default: for each column, draw missing values from a down-shifted
    normal fitted on observed log2 intensities (mean - shift*sd, sd*width).
    """
    rng = np.random.default_rng(seed)
    out = log2_matrix.copy()
    for col in cols:
        observed = out[col].to_numpy(dtype=float, copy=True)
        mask = ~np.isfinite(observed)
        finite = observed[~mask]
        if finite.size < 2 or not mask.any():
            continue
        mu = float(np.mean(finite))
        sigma = float(np.std(finite, ddof=1))
        if not np.isfinite(sigma) or sigma <= 0:
            sigma = 1.0
        draw_mu = mu - shift * sigma
        draw_sigma = width * sigma
        n_miss = int(mask.sum())
        draws = rng.normal(loc=draw_mu, scale=draw_sigma, size=n_miss)
        observed[mask] = draws
        out[col] = observed
    return out


def impute_methods(
    linear_matrix: pd.DataFrame,
    cols: list[str],
    methods: list[str],
    *,
    shift: float = 1.8,
    width: float = 0.3,
    seed: int = 42,
) -> dict[str, pd.DataFrame]:
    log2 = to_log2(linear_matrix, cols)
    results: dict[str, pd.DataFrame] = {}
    for method in methods:
        m = (method or "none").lower()
        if m in ("none", "no", "raw"):
            results[m] = log2
        elif m in ("perseus_left_censored", "perseus"):
            results["perseus_left_censored"] = perseus_left_censored(
                log2, cols, shift=shift, width=width, seed=seed
            )
        elif m == "mle":
            # cheap column-mean fill on log2 (placeholder MLE for smoke)
            filled = log2.copy()
            for col in cols:
                mu = filled[col].mean(skipna=True)
                if pd.isna(mu):
                    mu = 0.0
                filled[col] = filled[col].fillna(mu)
            results["mle"] = filled
        else:
            raise ValueError(f"Unknown imputation method: {method}")
    return results
