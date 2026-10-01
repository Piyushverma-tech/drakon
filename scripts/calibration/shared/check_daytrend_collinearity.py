"""
Predeclared day_index admissibility diagnostic.

Run 2 (2026-09-19) found day_index collinear with activity_tau*h within
the storm-recovery window (r=-0.83 to -0.95) and dropped it for that
window's headline spec after the fact -- a decision made by looking at
the result first. That is exactly the "researcher degrees of freedom"
failure mode this log is otherwise careful about (see Run 1's original
false-positive lesson). This module exists so the same decision is never
made that way again: the admissibility check runs BEFORE the coefficient
is fit, on a predeclared threshold, and its output determines whether a
given window/band/tau's day_index-included model is reported as the
primary estimator or demoted to a sensitivity-analysis footnote.

Rule (predeclared here, not chosen per-run):
    |corr(activity_tau*h, day_index)| >= COLLINEARITY_THRESHOLD
        => day_index and the exposure are not simultaneously identifiable
           in that band/tau. The day_index-included spec is reported as
           sensitivity analysis only; the no-day_index spec is primary.
    below threshold
        => day_index plausibly captures a background trend separable
           from the geomagnetic exposure. The day_index-included spec is
           primary; no-day_index is the sensitivity check instead.

Threshold: 0.8, the conventional "high collinearity" cutoff (roughly
VIF=~2.8; the stricter VIF>=5 convention corresponds to ~0.89, VIF>=10 to
~0.95 -- 0.8 is deliberately the more conservative end of the
conventional range, since a wrong "primary" label here is exactly the
failure mode being guarded against).

This must be run once per window before either bootstrap script, and the
result -- not a judgment call at write-up time -- decides which of
bootstrap_analysis.py / bootstrap_analysis_no_trend.py's numbers are
quoted as primary in the log.
"""

import argparse
import sys as _sys
_sys.path.insert(0, __file__.rsplit("/", 1)[0])
from preprocessing import CALIBRATION_MIN_HOURS_ELAPSED
import pandas as pd

COLLINEARITY_THRESHOLD = 0.8
TAUS = [6, 12, 18, 24]
ALT_LABELS = ['<200', '200-250', '250-300', '300-350']


def check_window(csv_path: str, min_hours: int, label: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df['epoch'] = pd.to_datetime(df['epoch'], format='ISO8601')

    rows = []
    for band in ALT_LABELS:
        b = df[(df['alt_band'] == band) & (df['hours_elapsed'] >= min_hours)].copy()
        if len(b) < 20:
            continue
        b['day_index'] = (b['epoch'] - b['epoch'].min()).dt.total_seconds() / 86400
        for tau in TAUS:
            col = f'activity_tau{tau}h'
            sub = b[[col, 'day_index']].dropna()
            if len(sub) < 20:
                continue
            r = sub.corr().iloc[0, 1]
            admissible = abs(r) < COLLINEARITY_THRESHOLD
            rows.append({
                'window': label, 'band': band, 'tau': tau, 'n': len(sub),
                'corr_activity_dayindex': round(r, 4),
                'day_index_admissible_as_primary': admissible,
            })
    return pd.DataFrame(rows)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('csv_path')
    p.add_argument('--min-hours', type=int, default=CALIBRATION_MIN_HOURS_ELAPSED)
    p.add_argument('--label', default=None)
    args = p.parse_args()
    out = check_window(args.csv_path, args.min_hours, args.label or args.csv_path)
    with pd.option_context('display.max_rows', None, 'display.width', 120):
        print(out.to_string(index=False))
