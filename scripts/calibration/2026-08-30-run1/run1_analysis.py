"""
Stage 3 calibration — Run 1 analysis (2026-08-30).
GEOMAGNETIC_STORM_REENTRY_PLAN.md §17.

Reproduces the full analysis logged in docs/GEOMAGNETIC_CALIBRATION_LOG.md
("Run 1") from the two raw input files in this directory:

  - tle_raw.csv        : real tle_history rows, perigee_km < 350, one row
                         per (norad_id, UTC day) -- see run1_queries.sql
  - real_ap_series.csv : real NOAA SWPC "Daily Geomagnetic Data" Estimated
                         Planetary Kp, converted to ap via this repo's own
                         normalizeKpClass()/kpToAp() (see
                         convert_dgd_to_ap.ts) -- NOT re-derived here, to
                         guarantee the analysis uses the exact same
                         conversion the production code uses.

Requires: pandas, numpy, scipy, statsmodels
    pip install pandas numpy scipy statsmodels

Run: python3 run1_analysis.py
"""

import pandas as pd
import numpy as np
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats

ALT_BINS = [0, 200, 250, 300, 350]
ALT_LABELS = ['<200', '200-250', '250-300', '300-350']


def load_and_compute_rates(tle_csv: str) -> pd.DataFrame:
    """Per-object consecutive-epoch decay rates, normalized to km/day by
    actual elapsed time (epochs from the daily DISTINCT ON dedup are not
    exactly 24h apart)."""
    df = pd.read_csv(tle_csv)
    df['epoch'] = pd.to_datetime(df['epoch'], format='ISO8601')
    df = df.sort_values(['norad_id', 'epoch'])

    df['prev_epoch'] = df.groupby('norad_id')['epoch'].shift(1)
    df['prev_perigee'] = df.groupby('norad_id')['perigee_km'].shift(1)
    df['prev_sma'] = df.groupby('norad_id')['semi_major_axis_km'].shift(1)
    df['prev_bstar'] = df.groupby('norad_id')['bstar'].shift(1)

    df['hours_elapsed'] = (df['epoch'] - df['prev_epoch']).dt.total_seconds() / 3600
    df = df[df['hours_elapsed'].notna()]
    # Drop degenerate/absurd gaps (data-quality guard, not a calibration choice)
    df = df[(df['hours_elapsed'] > 1) & (df['hours_elapsed'] < 60)]

    df['perigee_rate_km_per_day'] = (
        (df['perigee_km'] - df['prev_perigee']) / df['hours_elapsed'] * 24
    )
    df['sma_rate_km_per_day'] = (
        (df['semi_major_axis_km'] - df['prev_sma']) / df['hours_elapsed'] * 24
    )

    df['alt_band'] = pd.cut(df['prev_perigee'], bins=ALT_BINS, labels=ALT_LABELS)
    return df


def match_mean_ap(rates: pd.DataFrame, ap_csv: str) -> pd.DataFrame:
    """Time-weighted mean ap over each rate-interval's [prev_epoch, epoch] span."""
    ap = pd.read_csv(ap_csv)
    ap['intervalStart'] = pd.to_datetime(ap['intervalStart'], format='ISO8601')
    ap['intervalEnd'] = ap['intervalStart'] + pd.Timedelta(hours=3)

    def mean_ap_over_window(start, end):
        overlap_start = ap['intervalStart'].clip(lower=start)
        overlap_end = ap['intervalEnd'].clip(upper=end)
        overlap_hours = (overlap_end - overlap_start).dt.total_seconds().clip(lower=0) / 3600
        total_hours = overlap_hours.sum()
        return (ap['ap'] * overlap_hours).sum() / total_hours if total_hours > 0 else np.nan

    rates = rates.copy()
    rates['mean_ap'] = rates.apply(
        lambda r: mean_ap_over_window(r['prev_epoch'], r['epoch']), axis=1
    )
    return rates[rates['mean_ap'].notna()]


def analyze_band(band_df: pd.DataFrame, band_name: str) -> None:
    band_df = band_df.copy()
    band_df['day_index'] = (
        band_df['epoch'] - band_df['epoch'].min()
    ).dt.total_seconds() / 86400

    if len(band_df) < 10:
        print(f"=== {band_name} km: n={len(band_df)}, too few for regression ===\n")
        return

    X = sm.add_constant(band_df[['mean_ap', 'day_index']])
    y = band_df['perigee_rate_km_per_day']

    ols = sm.OLS(y, X).fit()
    rlm = sm.RLM(y, X, M=sm.robust.norms.HuberT()).fit()
    qr = smf.quantreg('perigee_rate_km_per_day ~ mean_ap + day_index', band_df).fit(q=0.5)
    jb_stat = sm.stats.stattools.jarque_bera(ols.resid)[0]

    print(f"=== {band_name} km (n={len(band_df)}) ===")
    print(f"  OLS      mean_ap coef: {ols.params['mean_ap']:+.4f}  p={ols.pvalues['mean_ap']:.4f}")
    print(f"  RLM      mean_ap coef: {rlm.params['mean_ap']:+.4f}  p={rlm.pvalues['mean_ap']:.4f}  (Huber-T)")
    print(f"  QuantReg mean_ap coef: {qr.params['mean_ap']:+.4f}  p={qr.pvalues['mean_ap']:.4f}  (median)")
    print(f"  OLS residual Jarque-Bera stat: {jb_stat:.1f} (heavy tails if large)")
    print()


if __name__ == '__main__':
    rates = load_and_compute_rates('tle_raw.csv')
    rates = match_mean_ap(rates, 'real_ap_series.csv')
    rates.to_csv('tle_rates_with_ap.csv', index=False)
    print(f"Total matched rate-intervals: {len(rates)} (written to tle_rates_with_ap.csv)\n")

    for band in ALT_LABELS:
        analyze_band(rates[rates['alt_band'] == band], band)

    # Confound check: does excluding near-terminal objects (prev_perigee
    # < 210km, naturally huge/volatile decay regardless of ap) change the
    # 200-250km conclusion?
    band_200_250 = rates[rates['alt_band'] == '200-250'].copy()
    rest = band_200_250[band_200_250['prev_perigee'] >= 210].copy()
    rest['day_index'] = (rest['epoch'] - rest['epoch'].min()).dt.total_seconds() / 86400
    qr_rest = smf.quantreg('perigee_rate_km_per_day ~ mean_ap + day_index', rest).fit(q=0.5)
    print(f"200-250km EXCLUDING near-terminal (prev_perigee<210km) objects: "
          f"n={len(rest)}, mean_ap coef={qr_rest.params['mean_ap']:+.4f}, "
          f"p={qr_rest.pvalues['mean_ap']:.4f}")
