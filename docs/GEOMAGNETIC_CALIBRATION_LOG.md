# Geomagnetic Multiplier Calibration Log

Living record of Stage 3 calibration work (`GEOMAGNETIC_STORM_REENTRY_PLAN.md`
§17 and §21). Each entry documents one calibration attempt: the real data
used, the methodology, the result — including null results — and what
changed (or explicitly didn't change) in `lib/geomagneticIndex.ts` as a
consequence. This log exists so a calibration decision is never just a
constant sitting in code with no record of what evidence (or lack of it)
justified the value.

**Ground rule this log exists to enforce:** a decision to update a
calibration constant is only logged here after a robustness check, not
before. A promising p-value from a single method is not a calibration
decision. See Run 1 below for exactly why this matters in practice, not
just in principle.

---

## Run 1 — 2026-08-30

**Context.** A G1–G2 geomagnetic storm *watch* (forecast) was in effect
2026-08-27 through 2026-08-29. **Correction, made 2026-08-31 — see
Addendum below:** the activity actually *observed* stayed below G1.
NOAA's G-scale maps Kp=5 to G1; the real NOAA data used for this analysis
peaked at Kp 4+ (ap 32) on 2026-08-29, which sits in the "Active" band,
one step below the G1 storm threshold. The original version of this
entry described this as an observed "G1–G2 storm," which was wrong — the
forcing was real and elevated relative to the preceding quiet days, but
did not cross into storm territory by NOAA's own definition. The Stage 2
shadow-mode cron (`POST /api/internal/geomagnetic-shadow`) had only just
been configured on 2026-08-29, so it captured the tail of this period but
not the buildup — raw `tle_history` plus an independently-sourced real ap
series were used instead, covering the full window.

**Data sources.**

| Source | What | Coverage |
|---|---|---|
| `tle_history` (production Neon Postgres) | Raw orbital elements (bstar, perigee, apogee, SMA, mean motion, mean motion dot), `perigee_km < 350`, one row per (object, UTC day) — see `scripts/calibration/2026-08-30-run1/run1_queries.sql` | 2026-08-22 to 2026-08-29, 3,993 rows, 610 objects |
| NOAA SWPC "Daily Geomagnetic Data" (`daily-geomagnetic-indices.txt`) | Official Estimated Planetary Kp, 3-hourly, converted to ap via this repo's own `normalizeKpClass()`/`kpToAp()` — see `scripts/calibration/2026-08-30-run1/convert_dgd_to_ap.ts` | 2026-08-22 to 2026-08-30 (partial), 68 real intervals |
| `geomagnetic_shadow_runs` (live production table) | Real-time shadow-mode captures, used only as a cross-check | 2026-08-29 to 2026-08-30, 17 rows |

**A finding before the calibration finding.** The live shadow-mode capture
and the NOAA DGD retrospective product genuinely disagree at some
overlapping timestamps for the same real-world moment — e.g. at
2026-08-29 21:56 UTC the live nowcast recorded Kp "1+" (ap 5) while DGD's
settled 21:00–24:00 bucket reports "2o" (ap 7). This is real, observed
confirmation of exactly the distinction `estimatedAp` was named for:
NOAA's real-time one-minute feed is a provisional nowcast that can differ
from the later-settled retrospective product for the same interval. DGD
was used as the ground truth for this analysis specifically because it's
the more settled, official product — not because the live capture is
wrong, but because it's provisional by design.

**Methodology.**

1. Per-object consecutive-epoch decay rates (perigee km/day, SMA km/day),
   normalized by *actual* elapsed hours between epochs (not assumed 24h
   gaps — the daily dedup query picks one epoch/day but real gaps ranged
   ~2–56h).
2. Stratified by starting altitude band (`<200`, `200-250`, `250-300`,
   `300-350` km) — pooling the full range dilutes any real signal, since
   atmospheric density varies by roughly two orders of magnitude across it.
3. Each rate-interval matched to the time-weighted mean ap over its exact
   span, from the real DGD-derived series.
4. OLS regression `perigee_rate ~ mean_ap + day_index`, with `day_index`
   included specifically to control for the fact that ap rose
   monotonically across the window (quiet Aug 22–27 → storm Aug 28–30) —
   without controlling for this, any pre-existing time trend in decay
   rate would produce a spurious ap correlation for free.
5. **Robustness check** (requested explicitly before any calibration
   number was derived): Huber-T robust regression (RLM) and median
   (quantile) regression, run alongside OLS on the same data.

**Results.**

| Band | n | OLS coef (p) | RLM coef (p) | Median-reg coef (p) | OLS resid. JB stat |
|---|---:|---|---|---|---:|
| <200km | 32 | -0.622 (0.442) | -0.646 (0.441) | -0.793 (0.532) | 3.0 |
| **200-250km** | **127** | **-0.236 (0.019)** | **-0.153 (0.027)** | **-0.019 (0.782)** | **277.1** |
| 250-300km | 601 | -0.147 (0.001) | -0.010 (0.504) | -0.018 (0.244) | 11,991.4 |
| 300-350km | 2,598 | -0.047 (0.0002) | -0.010 (0.003) | -0.005 (0.199) | 97,340.4 |

**What actually happened, in order.** OLS on the 200-250km band initially
looked like a real finding: p=0.019, correctly signed, and it survived
controlling for the time-trend confound. That result was reported and
nearly treated as evidence for a calibration update. The robustness check
changed the conclusion: RLM shrank the coefficient by ~35% and it stayed
marginally significant, but the median regression — the estimator least
sensitive to a handful of extreme observations — found essentially
nothing (coefficient 8x smaller, p=0.78). The severe residual
heavy-tailedness (Jarque-Bera 277 on n=127; far worse in the larger
bands) was the tell that OLS shouldn't have been trusted alone here.

**Outlier investigation.** The ten most extreme observations in the
200-250km band include one clear non-drag event (NORAD 100428: perigee
*increased* 23.8 km/day with BSTAR flipping sign — a maneuver or bad fit,
not atmospheric decay) and several objects with `prev_perigee` under
210km showing decay rates of -15 to -29 km/day regardless of whether ap
was elevated or quiet at the time — consistent with objects already in
natural terminal-decay behavior, where decay rate becomes large and
volatile independent of storm activity. To check whether this fully
explained the OLS/median divergence, the regression was re-run excluding
every object with `prev_perigee < 210km` (n drops from 127 to 116): the
median regression still finds nothing (coefficient +0.005, p=0.94). The
null result is not an artifact of those specific outliers — it holds
either way.

**Conclusion.** This single, modest storm does not provide sufficiently
robust evidence to update any geomagnetic multiplier calibration
parameter. The apparent 200-250km signal does not survive median
regression, with or without the identified outliers excluded.

> **Caveat added 2026-08-31 — read the Addendum before trusting this
> paragraph on its own.** The reasoning above (median regression "finds
> nothing," therefore no effect) is not quite right, and the Addendum
> below explains why: none of Run 1's p-values — the OLS ones that looked
> significant *or* the median-regression ones that didn't — are valid
> independent-observation p-values, because every satellite in the sample
> shared essentially the same geomagnetic exposure. "No calibration
> change" is still the right call, but for a more fundamental reason
> (one storm's worth of shared exposure can't resolve this either way)
> than "it failed a robustness check."

**Decision: no change to `lib/geomagneticIndex.ts`.**
`GEOMAG_MODEL_VERSION` remains `0` (uncalibrated). `GEOMAG_AMPLITUDE`,
`GEOMAG_SCALE`, `GEOMAG_POWER`, `GEOMAG_ACTIVITY_THRESHOLD`, and
`MAX_GEOMAG_MULTIPLIER` are unchanged. A "we don't yet have sufficient
evidence" outcome is a valid, expected, and — per the plan's own §1
philosophy — the scientifically correct outcome for a single-storm
attempt to be logged as such, not something to route around by fitting to
whichever estimator happened to produce a usable-looking number. (This
decision holds after the Addendum below too — see there for why, and for
a more useful characterization of what the data actually supports.)

**What this run did accomplish, despite the null result:**
- Validated the full Phase 1/6 data-assembly and analysis path end-to-end
  against real production data (real `tle_history`, real NOAA data, real
  shadow-mode cross-check) — the harness works.
- Produced real, if indirect, confirmation that the `estimatedAp` /
  official-ap distinction (Change 1, Stage 1/2 work) reflects a genuine
  real-world discrepancy, not just a theoretical concern.
- Identified a concrete data-quality practice for future runs: flag or
  exclude apparent maneuvers (sign-flipping BSTAR, physically-implausible
  perigee increases) and near-terminal-decay objects before regression,
  since they dominate the tails and can produce false-positive
  correlations under non-robust methods.
- Demonstrated, in practice rather than in the abstract, why a
  robustness check has to happen *before* trusting a promising p-value —
  this run would have produced an unjustified calibration update if it
  had stopped at the first OLS pass.

**Next steps for Run 2+:**
- Filter out likely-maneuvering and near-terminal (`prev_perigee` below
  some agreed cutoff, e.g. 210km) objects as a standard preprocessing
  step, not an ad hoc check.
- Accumulate more storms — the plan's own Phase 1 standard calls for
  multiple storm and quiet-control periods, not one. `geomagnetic_shadow_runs`
  is now capturing live data continuously, so future runs may be able to
  pull the ap series directly from production instead of an external DGD
  fetch, once enough history accumulates there.
- Run a genuinely independent quiet control window through this same
  real pipeline (not just the historical GFZ fixtures used for Stage 1
  parser validation) for a proper storm-vs-control comparison.
- A bigger storm would help — this one topped out around Kp 4+ (ap 32),
  modest as space weather events go. The effect this correction targets
  may simply need a stronger forcing to detect reliably against the
  BSTAR-fit noise floor evident in the JB statistics above.

### Addendum — external methodological review and re-analysis (2026-08-31)

An external review of this entry identified five real problems with the
original analysis, plus the G1–G2 wording error corrected above (in the
Context paragraph, in place, rather than left standing). Full credit to
that review — every specific number it cited (31 objects in the
200-250km band, hours_elapsed ranging 1.52–59.42h, 102 of 3,358 intervals
below 12h) was verified against the actual Run 1 data before writing
anything here, and all of them checked out exactly.

**1. The p-values were never valid independent-observation p-values.**
127 observations in the 200-250km band come from only 31 objects and
share a single, common time-varying geomagnetic exposure — every
satellite in the sample experienced essentially the same storm forcing at
the same time. That means the "sample size" that matters for statistical
power isn't 127 rows, or even 31 objects; it's closer to the number of
independent geomagnetic *events*, which in Run 1 is **one**. Huber-T and
median regression protect against outliers; neither one fixes this. This
means the original "OLS says p=0.019" and "median regression says
p=0.78" were **both** untrustworthy as conventional significance
statements, not just the first one. The corrected reading is that Run 1
was structurally underpowered to resolve this question either way, which
makes "no calibration change" the right call for a *more fundamental*
reason than "it failed a robustness check."

**2. Run 1 didn't test the production predictor.** The multiplier that
would eventually run in production consumes
`computeRecencyWeightedActivity()` — a recency-weighted feature with an
exponential decay constant (`GEOMAG_DECAY_CONSTANT_HOURS`, currently a
12h placeholder) — not an unweighted mean ap over each TLE epoch's span.
Those are different functional forms, and Run 1's design implicitly
assumed zero response lag with a boxcar memory window shaped by whatever
gap happened to exist between consecutive TLE epochs. Thermospheric
density is well documented in the aeronomy literature to respond to
geomagnetic forcing with a lag on the order of several hours, not
instantaneously — so testing zero-lag alone wasn't just a simplification,
it was testing a predictor Stage 2 doesn't actually use.

**3. TLE interval lengths were treated as equally reliable.** Finite-
difference decay rates from a 2-hour gap carry far more noise than from a
28-hour gap (the same absolute TLE fit noise divided by a much smaller
Δt), and Run 1 weighted a 1.5-hour-gap rate the same as a 59-hour one.
102 of 3,358 retained intervals were under 12 hours (concentrated mostly
in the larger, noisier altitude bands — only 2 of the 200-250km band's
127 were that short, but the practice should be standard regardless).

**4. Run 1 should be understood as a screening experiment, not a lag
study.** Distinguishing these two matters for how the result should be
read: Run 1 asked "is decay rate contemporaneously associated with mean
ap," not "at what timescale does decay rate respond to geomagnetic
forcing." Those are different questions, and only the second one is
directly useful for calibrating `GEOMAG_DECAY_CONSTANT_HOURS`.

**5. The quiet control fixture was never actually used in the orbital
regression.** `GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024` is real and
useful for the Stage 1/2 parser-validation tests it was built for, but
Run 1's decay-rate analysis used only the Aug 22-30 window around the
event — it never tested "does the model stay neutral during a genuinely
quiet period," which is the specific check Phase 7 asks for. Not a
problem for Run 1 specifically (no calibration change was made), but a
gap Run 2 needs to close with real, paired TLE + ap data for an actual
quiet window — the Jan 2024 fixture can't be reused for this since
`tle_history`'s 35-day retention makes real orbital data from that period
permanently unavailable now.

**Re-analysis, addressing points 1-3 with the data already on hand.**
Using `lib/geomagneticIndex.ts`'s actual `computeRecencyWeightedActivity()`
directly (not reimplemented — see
`scripts/calibration/2026-08-30-run1/addendum_lagged_activity.ts`), four
candidate decay constants were tested (τ = 6h, 12h, 18h, 24h), each
evaluated at every TLE epoch using the same real ap series as Run 1. The
function's own look-ahead guard (`ageHours < 0` is skipped — see
`geomagneticIndex.test.ts`'s "no look-ahead bias" tests) makes it safe to
evaluate at any past instant without leaking future data. Intervals under
12 hours were excluded (127 → 125 observations in the 200-250km band).
For uncertainty, a **day-block bootstrap** was used instead of
row-level or even cluster-robust standard errors: with only **7**
distinct days of data, conventional cluster-robust inference is itself
unreliable (typical guidance wants 30+ clusters), so this addendum
resamples *whole days* with replacement (2,000 resamples, fixed seed) —
the honest way to quantify uncertainty when 7 day-blocks is the true
extent of independent temporal replication. Script:
`scripts/calibration/2026-08-30-run1/addendum_analysis.py`.

| τ (decay constant) | Point estimate | Day-block bootstrap 95% CI | Bootstrap p |
|---|---|---|---|
| 6h | -0.216 | [-0.492, +0.021] | 0.055 |
| **12h (current placeholder)** | **-0.316** | **[-1.233, -0.095]** | **0.031** |
| 18h | -0.372 | [-1.967, -0.153] | 0.029 |
| 24h | -0.423 | [-2.380, -0.199] | 0.023 |

**What this shows.** The relationship is directionally consistent
(negative — higher activity, faster decay — at every τ tested) and grows
stronger with longer memory: 3 of 4 candidate lags have a 95% CI that
excludes zero, including the current 12h production placeholder, and the
point estimate nearly doubles from τ=6h to τ=24h. This is a genuinely
different and more informative picture than either Run 1's original OLS
("significant") or its median regression ("nothing") — both of which
were answering the wrong question with the wrong predictor. It's also
not a basis for a calibration decision: the confidence intervals span
roughly an order of magnitude, which is the honest cost of having only 7
independent day-blocks from a single event. What it *does* provide is a
concrete, evidence-based direction for Run 2 — test τ toward the longer
end (18-24h) rather than assuming the 12h placeholder is already close,
and prioritize getting more independent time-blocks (more storms) over
more rows from this one.

**Decision unchanged.** `GEOMAG_MODEL_VERSION` stays `0`; no constants in
`lib/geomagneticIndex.ts` changed as a result of this addendum either.
The addendum strengthens confidence that *something* real may be here,
directionally, but strengthening a hint is not the same as clearing the
bar for a calibration update, and Issue 5 (no quiet-control comparison
yet) remains fully open.

---

## Run 2 — Planned (not yet executed)

Scope, per the addendum above: this should be the first calibration
attempt with (a) the actual production lagged-activity predictor across
multiple candidate τ, (b) a real, paired quiet-control window run through
the identical pipeline, and (c) uncertainty quantification that respects
the shared-exposure/clustering structure from the start rather than as a
correction after the fact. Only once Run 2 (or a later run) shows an
effect that survives all three should A/scale/power/`MAX_GEOMAG_MULTIPLIER`
sweeping begin — not before.

**1. Data needed (new, beyond what Run 1 collected).**

A genuine quiet-control window, paired the same way Run 1 paired the
storm window: real `tle_history` (same perigee filter, same daily-dedup
grain) plus the real NOAA DGD Kp/ap series, for a period that is (a)
inside the 35-day retention window *at Run 2's execution time* (the
window will have moved on — check current retention before picking
dates) and (b) genuinely quiet by the DGD product's own numbers, not
merely "not storming." Query template (parameterize `$START`/`$END` once
a real quiet window is identified from a fresh DGD pull):

```sql
SELECT DISTINCT ON (norad_id, date_trunc('day', epoch))
  norad_id, epoch, bstar, mean_motion, mean_motion_dot, eccentricity,
  perigee_km, apogee_km, semi_major_axis_km, source_group
FROM tle_history
WHERE epoch >= '$START' AND epoch < '$END' AND perigee_km < 350
ORDER BY norad_id, date_trunc('day', epoch), epoch DESC;
```

Ideally also: whatever the *next* real storm turns out to be, of any
magnitude — genuinely independent day-blocks/events matter far more here
than a larger pull from the same event (Issue 1). If `geomagnetic_shadow_runs`
has accumulated enough continuous history by then, prefer it over a fresh
DGD pull for the ap series — it's already real, already paired to the
production `estimatedAp` semantics, and avoids the external-fetch step
entirely.

**2. Methodology (extends the addendum, doesn't replace it).**

- Compute `activity_τ` at every TLE epoch for both the storm and control
  windows, same candidate τ set as the addendum (6/12/18/24h; consider
  widening if the addendum's trend toward longer τ continues) via the
  same `computeRecencyWeightedActivity()` reuse pattern.
- Apply the same ≥12h duration filter, and the same maneuver/near-terminal
  exclusion identified in the addendum (`prev_perigee < 210km`, plus a
  BSTAR-sign-flip check) as standard preprocessing, not an ad hoc pass.
- Fit both windows with the same day-block-bootstrap design. Report the
  **storm-window CI and the control-window CI side by side** for every τ
  — the control window passes if its CI comfortably straddles zero at
  the τ where the storm window doesn't. That comparison, not either
  window's p-value alone, is the actual Phase 7 quiet-window check.
- If enough independent storm events have accumulated by the time this
  runs, prefer pooling across events (e.g. a mixed-effects model with a
  random effect per event) over a single storm/control pair — closer to
  what Issue 1 actually calls for, and worth the added complexity once
  there's a second event to pool with.

**3. Explicit non-goals for Run 2.** No change to
`GEOMAG_AMPLITUDE`/`GEOMAG_SCALE`/`GEOMAG_POWER`/`MAX_GEOMAG_MULTIPLIER`
unless the storm-vs-control comparison above comes back clean — a
promising storm-window result with an untested control window is exactly
the mistake this addendum exists to prevent from recurring.

**Results.** *(to be filled in when executed)*
**Conclusion.** *(to be filled in when executed)*
**Decision.** *(to be filled in when executed)*

---

## Template for future runs

```
## Run N — YYYY-MM-DD

**Context.**
**Data sources.**
**Methodology.**
**Results.**
**Robustness check.**
**Conclusion.**
**Decision:** [no change / specific constant(s) changed, old -> new value, why]
**Next steps.**
```
