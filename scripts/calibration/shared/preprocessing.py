"""
Shared calibration preprocessing (factored out for Run 2, per
GEOMAGNETIC_CALIBRATION_LOG.md "Next steps for Run 2+").

Run 1 implemented per-object decay-rate computation and one exclusion
(prev_perigee < 210km) inline in run1_analysis.py. The log explicitly
flagged this as something that needed to become "standard preprocessing,
not an ad hoc pass" for Run 2 -- because any window (storm, control, or
secondary regime) that skips or reimplements this differently would
silently contaminate the storm-vs-control comparison the whole run exists
to make.

This module is the one place that logic now lives. It also adds the
BSTAR-sign-flip check the log called for but Run 1 never actually wrote:
Run 1's outlier investigation found NORAD 100428 with perigee *increasing*
23.8 km/day while BSTAR flipped sign -- a maneuver or bad orbital fit, not
atmospheric decay -- but Run 1 only excluded by prev_perigee, not by this.

Every window run through Run 2 must call these same functions, in this
same order, so the comparison in the "Results" table is actually a
same-preprocessing comparison.
"""

import pandas as pd

ALT_BINS = [0, 200, 250, 300, 350]
ALT_LABELS = ['<200', '200-250', '250-300', '300-350']

# Two distinct duration filters, at two distinct pipeline stages, that
# must not be conflated (raised explicitly after Run 2's log entry):
#
#   1-60h  = ADMISSIBLE INTERVAL CONSTRUCTION. Applied inside
#            load_and_compute_rates() itself, before any analysis
#            decision. Below 1h: near-duplicate epochs, division blows
#            up. Above 60h: dedup artifacts / multi-day silent gaps, not
#            a single decay interval. This is a data-quality guard, not
#            a statistical threshold -- an interval this wide is not
#            being asserted to be *valid for calibration*, only
#            computable at all.
#
#   >=12h  = CALIBRATION-ANALYSIS INCLUSION CRITERION. Applied by the
#            analysis scripts (bootstrap_analysis*.py,
#            check_daytrend_collinearity.py) on top of the already-
#            admissible rows, matching the production duration filter
#            the multiplier is actually evaluated under. This is the
#            number that should change if the production filter changes
#            -- 1h and 60h should not.
MIN_GAP_HOURS = 1
MAX_GAP_HOURS = 60
CALIBRATION_MIN_HOURS_ELAPSED = 12

# Standard exclusion 1 (Run 1 finding, applied ad hoc there): objects
# already below this altitude show large, volatile decay independent of
# geomagnetic forcing -- natural terminal-decay behavior, not a drag
# response to ap. Re-running the addendum's confound check without this
# filter is what would silently reintroduce Run 1's original false-positive
# risk in the 200-250km band.
NEAR_TERMINAL_PERIGEE_KM = 210


def load_and_compute_rates(tle_csv: str) -> pd.DataFrame:
    """Per-object consecutive-epoch decay rates, normalized to km/day by
    actual elapsed time (daily-dedup epochs are not exactly 24h apart).
    Identical to Run 1's load_and_compute_rates -- unchanged, just moved
    here so every window's rates are computed the same way."""
    df = pd.read_csv(tle_csv)
    df['epoch'] = pd.to_datetime(df['epoch'], format='ISO8601')
    df = df.sort_values(['norad_id', 'epoch'])

    df['prev_epoch'] = df.groupby('norad_id')['epoch'].shift(1)
    df['prev_perigee'] = df.groupby('norad_id')['perigee_km'].shift(1)
    df['prev_sma'] = df.groupby('norad_id')['semi_major_axis_km'].shift(1)
    df['prev_bstar'] = df.groupby('norad_id')['bstar'].shift(1)

    df['hours_elapsed'] = (df['epoch'] - df['prev_epoch']).dt.total_seconds() / 3600
    df = df[df['hours_elapsed'].notna()]
    df = df[(df['hours_elapsed'] > MIN_GAP_HOURS) & (df['hours_elapsed'] < MAX_GAP_HOURS)]

    df['perigee_rate_km_per_day'] = (
        (df['perigee_km'] - df['prev_perigee']) / df['hours_elapsed'] * 24
    )
    df['sma_rate_km_per_day'] = (
        (df['semi_major_axis_km'] - df['prev_sma']) / df['hours_elapsed'] * 24
    )

    df['alt_band'] = pd.cut(df['prev_perigee'], bins=ALT_BINS, labels=ALT_LABELS)
    return df


def flag_bstar_sign_flip(df: pd.DataFrame) -> pd.Series:
    """True where consecutive-epoch BSTAR changes sign with both values
    non-trivial in magnitude (a sign flip through near-zero noise isn't
    the same signal as a genuine fit discontinuity). This is the check
    Run 1's outlier investigation identified (NORAD 100428) but never
    turned into a reusable filter -- it only excluded by prev_perigee."""
    eps = 1e-6
    prev = df['prev_bstar']
    cur = df['bstar']
    both_nontrivial = (prev.abs() > eps) & (cur.abs() > eps)
    sign_flip = (prev * cur) < 0
    return both_nontrivial & sign_flip


def apply_standard_exclusions(df: pd.DataFrame) -> pd.DataFrame:
    """The two standard maneuver/near-terminal exclusions, applied together,
    as the calibration log's Run 2+ next-steps specify. Returns the
    filtered frame plus prints a short accounting of what was dropped and
    why, so an exclusion count is always visible in the run's own output
    rather than silently disappearing into a shrinking n."""
    n0 = len(df)
    bstar_flip = flag_bstar_sign_flip(df)
    near_terminal = df['prev_perigee'] < NEAR_TERMINAL_PERIGEE_KM

    out = df[~bstar_flip & ~near_terminal].copy()
    print(
        f"  standard exclusions: n={n0} -> {len(out)} "
        f"(bstar_sign_flip removed {bstar_flip.sum()}, "
        f"near_terminal<{NEAR_TERMINAL_PERIGEE_KM}km removed {near_terminal.sum()}, "
        f"overlap {(bstar_flip & near_terminal).sum()})"
    )
    return out


def match_mean_ap(rates: pd.DataFrame, ap_csv: str) -> pd.DataFrame:
    """Time-weighted mean ap over each rate-interval's [prev_epoch, epoch]
    span. Kept for continuity with Run 1's diagnostic column; Run 2's
    actual predictor is the lagged activity_tau*h columns added
    downstream by lagged_activity.ts, not this."""
    import numpy as np

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


def tag_phase(epoch: pd.Timestamp) -> str:
    """Per-epoch phase label per plan §18 (onset/main/recovery/quiet) plus
    the sub-G1 secondary-active regimes identified from the real DGD
    data (Aug 27-29, Sep 14-17, Sep 24-26) -- all explicitly kept separate
    from 'storm', since none crossed the G1/Kp5 threshold DGD confirms for
    Sep 8 (Sep 24 peaks at Kp 4.33, same character as the other two).
    quiet_control_2 (Sep 18-23) is a second, independent quiet window --
    settled DGD shows it genuinely quiet throughout (max Kp 3.00) -- kept
    as its own label rather than merged into quiet_control so Run 2's
    edge-case results (τ=6h borderline, τ=24h contamination) can be
    checked for replication rather than just pooled. Boundaries below are
    UTC calendar days, matching the daily-dedup grain everywhere else in
    this pipeline."""
    d = epoch.date().isoformat()
    if '2026-09-01' <= d <= '2026-09-06':
        return 'quiet_control'
    if d == '2026-09-07':
        return 'storm_onset'
    if d == '2026-09-08':
        return 'storm_main'
    if '2026-09-09' <= d <= '2026-09-13':
        return 'storm_recovery'
    if '2026-08-27' <= d <= '2026-08-29':
        return 'secondary_active_aug'
    if '2026-09-14' <= d <= '2026-09-17':
        return 'secondary_active_sep'
    if '2026-09-18' <= d <= '2026-09-23':
        return 'quiet_control_2'
    if '2026-09-24' <= d <= '2026-09-26':
        return 'secondary_active_sep2'
    return 'unclassified'
