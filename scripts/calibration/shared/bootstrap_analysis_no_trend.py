"""
Companion to bootstrap_analysis.py -- same day-block bootstrap design, but
fits perigee_rate ~ activity_tau*h alone, WITHOUT the day_index trend-control
term.

Why this exists: within a single storm episode, day_index and the lagged
activity feature are severely collinear (r=-0.83 to -0.95 in the Sep 7-13
storm window here) -- "days since storm onset" and "declining ap" are
mechanistically almost the same variable. Including day_index in that
setting doesn't control for an independent confound the way it did in Run
1's addendum (where the window spanned a genuine quiet->storm transition,
so day and ap were correlated but not collinear); it mostly cancels the
very geomagnetic-recovery signal under test. This script fits the
no-day_index alternative so both specifications can be compared side by
side rather than trusting either one by default.

This is not obviously the "more correct" specification -- dropping
day_index also means any *non*-geomagnetic secular trend across the window
is no longer controlled for. Whether that matters is exactly what running
this against the control window is for: if the control window (which has
no storm-recovery arc to be collinear with) shows the same sign and
significance pattern as the storm window, the no-day_index result is
probably picking up a generic trend, not a geomagnetic one.

Usage:
    python3 bootstrap_analysis_no_trend.py <rates_with_lagged_activity.csv> [--min-hours 12]
"""

import argparse
import sys as _sys
_sys.path.insert(0, __file__.rsplit("/", 1)[0])
from preprocessing import CALIBRATION_MIN_HOURS_ELAPSED
import pandas as pd
import numpy as np
import statsmodels.api as sm

SEED = 20260919
N_BOOT = 2000
TAUS = [6, 12, 18, 24]
ALT_LABELS = ['<200', '200-250', '250-300', '300-350']


def fit_coef(df: pd.DataFrame, col: str) -> float:
    X = sm.add_constant(df[[col]])
    y = df['perigee_rate_km_per_day']
    return sm.OLS(y, X).fit().params[col]


def day_block_bootstrap(df: pd.DataFrame, col: str, days: np.ndarray, n_boot: int = N_BOOT):
    rng = np.random.default_rng(SEED)
    boot_coefs = []
    for _ in range(n_boot):
        sampled_days = rng.choice(days, size=len(days), replace=True)
        boot_df = pd.concat([df[df['day_bucket'] == d] for d in sampled_days], ignore_index=True)
        if boot_df[col].notna().sum() < 10:
            continue
        try:
            boot_coefs.append(fit_coef(boot_df, col))
        except Exception:
            continue
    return np.array(boot_coefs)


def analyze_window(csv_path: str, min_hours: int, label: str):
    rates = pd.read_csv(csv_path)
    rates['epoch'] = pd.to_datetime(rates['epoch'], format='ISO8601')

    print(f"\n{'=' * 70}\nWindow: {label} -- NO day_index term  ({csv_path})\n{'=' * 70}")

    for band in ALT_LABELS:
        band_df = rates[rates['alt_band'] == band].copy()
        band_df = band_df[band_df['hours_elapsed'] >= min_hours].copy()
        if len(band_df) < 20:
            continue

        band_df['day_bucket'] = band_df['epoch'].dt.date.astype(str)
        days = band_df['day_bucket'].unique()
        print(f"\n--- {band}km (n={len(band_df)}, n_day_blocks={len(days)}) ---")

        for tau in TAUS:
            col = f'activity_tau{tau}h'
            sub = band_df.dropna(subset=[col, 'perigee_rate_km_per_day'])
            if len(sub) < 20:
                continue
            point = fit_coef(sub, col)
            boot = day_block_bootstrap(sub, col, days)
            if len(boot) == 0:
                continue
            ci_lo, ci_hi = np.percentile(boot, [2.5, 97.5])
            p_boot = 2 * min((boot > 0).mean(), (boot < 0).mean())
            straddles_zero = ci_lo <= 0 <= ci_hi
            flag = "zero in CI" if straddles_zero else "CI EXCLUDES ZERO"
            print(f"  tau={tau:>2}h: point={point:+.4f}  CI=[{ci_lo:+.4f}, {ci_hi:+.4f}]  "
                  f"p~{p_boot:.3f}  -- {flag}")


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('csv_path')
    p.add_argument('--min-hours', type=int, default=CALIBRATION_MIN_HOURS_ELAPSED)
    p.add_argument('--label', default=None)
    args = p.parse_args()
    analyze_window(args.csv_path, args.min_hours, args.label or args.csv_path)
