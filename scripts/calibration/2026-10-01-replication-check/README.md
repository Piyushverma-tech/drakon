# Replication check — 2026-10-01 (not Run 3)

Backing artifacts for the "Replication check" entry in
`docs/GEOMAGNETIC_CALIBRATION_LOG.md`. Not a numbered run — no
calibration constant was ever in scope here. Opportunistic use of the
Sep 18-23 quiet stretch (identified from the Sep 27 DGD pull) as a
second, independent quiet-control replicate, to check whether Run 2's
control-window edge cases (τ=6h borderline, τ=24h contamination, both in
250-300km) were real or specific to that window's thin 5 day-blocks.

## Files

| File | What it is |
|---|---|
| `dgd_last30d.txt` | Raw NOAA DGD product, issued 1230 UT 27 Sep 2026, saved verbatim |
| `real_ap_series.csv` | `../shared/build_ap_series.ts` output against the above — 236 intervals, 2026-08-29 to 2026-09-27 (partial) |
| `quiet2_tle_raw.csv` | Requested pull: `epoch >= '2026-09-17' AND epoch < '2026-09-27'`. Returned data only covers Sep 17-24 and is missing 212 objects present in the Sep 7-13 storm pull (90% last seen in 300-350km). Cause confirmed: a Space-Track.org outage covering Sep 25-27, since resolved — not a production ingestion defect. See log |
| `quiet2_tle_rates_with_ap.csv` / `..._with_lagged_activity.csv` | Full preprocessed pull, both phases (`quiet_control_2` + the unusable 1-day `secondary_active_sep2`) |
| `quiet_control_2_only.csv` | `quiet_control_2` phase rows only (Sep 18-23) — this is what the log's results table is built from |

`secondary_active_sep2` (Sep 24-26) is present in the full
`quiet2_tle_rates_with_*` files but not separately extracted — only 1
day (Sep 24) actually landed due to the truncation above, not enough
for day-block bootstrap. Re-derivable if the ingestion gap gets
backfilled and this pull is re-run.

## Reproducing

```bash
npx tsx scripts/calibration/shared/build_ap_series.ts \
  scripts/calibration/2026-10-01-replication-check/dgd_last30d.txt \
  scripts/calibration/2026-10-01-replication-check/real_ap_series.csv

python3 -c "
import sys; sys.path.insert(0, 'scripts/calibration/shared')
from preprocessing import load_and_compute_rates, apply_standard_exclusions, match_mean_ap, tag_phase
rates = load_and_compute_rates('scripts/calibration/2026-10-01-replication-check/quiet2_tle_raw.csv')
rates['phase'] = rates['epoch'].apply(tag_phase)
rates = apply_standard_exclusions(rates)
rates = match_mean_ap(rates, 'scripts/calibration/2026-10-01-replication-check/real_ap_series.csv')
rates.to_csv('scripts/calibration/2026-10-01-replication-check/quiet2_tle_rates_with_ap.csv', index=False)
"

npx tsx scripts/calibration/shared/lagged_activity.ts \
  scripts/calibration/2026-10-01-replication-check/quiet2_tle_rates_with_ap.csv \
  scripts/calibration/2026-10-01-replication-check/real_ap_series.csv \
  scripts/calibration/2026-10-01-replication-check/quiet2_tle_rates_with_lagged_activity.csv

python3 -c "
import pandas as pd
df = pd.read_csv('scripts/calibration/2026-10-01-replication-check/quiet2_tle_rates_with_lagged_activity.csv')
df[df['phase']=='quiet_control_2'].to_csv('scripts/calibration/2026-10-01-replication-check/quiet_control_2_only.csv', index=False)
"

python3 scripts/calibration/shared/check_daytrend_collinearity.py \
  scripts/calibration/2026-10-01-replication-check/quiet_control_2_only.csv --label quiet_control_2
python3 scripts/calibration/shared/bootstrap_analysis.py \
  scripts/calibration/2026-10-01-replication-check/quiet_control_2_only.csv
python3 scripts/calibration/shared/bootstrap_analysis_no_trend.py \
  scripts/calibration/2026-10-01-replication-check/quiet_control_2_only.csv
```

See the log's "Replication check" entry for the full writeup, including
the 250-300km clean replication and the 200-250km wrong-signed result
that argues for treating that band as unreliable going forward.
