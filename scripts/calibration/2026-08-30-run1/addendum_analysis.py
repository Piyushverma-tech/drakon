"""
Run 1 addendum (2026-08-31) -- re-analysis following external methodological
review. See docs/GEOMAGNETIC_CALIBRATION_LOG.md "Run 1 -- Addendum" for the
narrative writeup this reproduces.

Three corrections to Run 1's original analysis:
  1. Predictor: uses the actual production computeRecencyWeightedActivity()
     feature (via addendum_lagged_activity.ts), tested across four candidate
     decay constants (tau=6,12,18,24h), instead of Run 1's unweighted mean-ap.
  2. Duration filter: excludes intervals with hours_elapsed < 12h (noisy
     finite-difference rates from short TLE gaps).
  3. Uncertainty: day-block bootstrap (resamples whole days, not individual
     rows) instead of naive OLS/cluster SEs -- appropriate given only 7
     independent day-blocks in this single-storm dataset.

Requires: pandas, numpy, statsmodels
Run: python3 addendum_analysis.py (after addendum_lagged_activity.ts)
"""

import pandas as pd
import numpy as np
import statsmodels.api as sm

SEED = 20260831
N_BOOT = 2000
TAUS = [6, 12, 18, 24]
MIN_HOURS = 12


def fit_coef(df: pd.DataFrame, col: str) -> float:
    X = sm.add_constant(df[[col, 'day_index']])
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


if __name__ == '__main__':
    rates = pd.read_csv('tle_rates_with_lagged_activity.csv')
    rates['epoch'] = pd.to_datetime(rates['epoch'], format='ISO8601')

    band = rates[rates['alt_band'] == '200-250'].copy()
    print(f"200-250km band before duration filter: n={len(band)}")
    band = band[band['hours_elapsed'] >= MIN_HOURS].copy()
    print(f"After hours_elapsed>={MIN_HOURS}h filter: n={len(band)}, objects={band['norad_id'].nunique()}")

    band['day_index'] = (band['epoch'] - band['epoch'].min()).dt.total_seconds() / 86400
    band['day_bucket'] = band['epoch'].dt.date.astype(str)
    days = band['day_bucket'].unique()
    print(f"n_day_blocks={len(days)}: {sorted(days)}\n")

    for tau in TAUS:
        col = f'activity_tau{tau}h'
        sub = band.dropna(subset=[col, 'perigee_rate_km_per_day'])
        point = fit_coef(sub, col)

        boot = day_block_bootstrap(sub, col, days)
        ci_lo, ci_hi = np.percentile(boot, [2.5, 97.5])
        p_boot = 2 * min((boot > 0).mean(), (boot < 0).mean())

        print(f"tau={tau}h: point estimate={point:+.4f}, "
              f"day-block bootstrap 95% CI=[{ci_lo:+.4f}, {ci_hi:+.4f}], p~{p_boot:.3f}")
