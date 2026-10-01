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

## Run 2 — 2026-09-19

Scope, per the addendum above: this should be the first calibration
attempt with (a) the actual production lagged-activity predictor across
multiple candidate τ, (b) a real, paired quiet-control window run through
the identical pipeline, and (c) uncertainty quantification that respects
the shared-exposure/clustering structure from the start rather than as a
correction after the fact. Only once Run 2 (or a later run) shows an
effect that survives all three should A/scale/power/`MAX_GEOMAG_MULTIPLIER`
sweeping begin — not before.

**Correction to initial framing.** Before execution, a candidate redesign
proposed treating both the Sep 8-9 event and a forecast Sep 15-17 episode
as two independent G1-threshold storms to pool. Checked directly against
NOAA's settled DGD product (30-day pull, issued 1230 UT 19 Sep 2026, not
a forecast): Sep 8 reaches Estimated Planetary Kp 5.00 (A=29) — a genuine
G1 crossing. Sep 15-17 tops out at Kp 3.67 (A=7-9) — elevated but well
short of G1, the same character as the Aug 27-29 episode Run 1 already
used. There is one genuine storm-threshold event in the currently
retained window, not two. The two-storm mixed-effects design was
dropped before execution; see "Next steps" below for what would actually
resolve this.

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

**Data sources actually used.**

| Source | What | Coverage |
|---|---|---|
| `tle_history` (production Neon Postgres) | Same query template as Run 1 (`perigee_km < 350`, daily-dedup) — see `scripts/calibration/2026-09-19-run2/{control,storm}_tle_raw.csv` | Control: 2026-09-01 to 2026-09-06 (592 objects, 3,395 rows). Storm: 2026-09-07 to 2026-09-13 (624 objects, 3,644 rows) |
| NOAA SWPC DGD, 30-day pull | Same product/column as Run 1, issued 1230 UT 2026-09-19, verbatim in `scripts/calibration/2026-09-19-run2/dgd_last30d.txt` | 2026-08-21 to 2026-09-19 (partial), 236 real 3h intervals, one continuous series covering both windows |
| `geomagnetic_shadow_runs` | Not used for this run — the DGD pull already covers both windows in one settled, non-nowcast series, so the live/settled discrepancy Run 1 flagged for the shadow cross-check doesn't apply here | n/a |

**Factoring done before execution** (this was flagged as required in "Next
steps for Run 2+" above, not optional): `run1_analysis.py`'s rate
computation and `prev_perigee<210km` exclusion moved into
`scripts/calibration/shared/preprocessing.py`, now applied identically to
every window via `apply_standard_exclusions()`. That function also adds
the BSTAR-sign-flip check this log called for after Run 1's NORAD 100428
finding but never actually implemented — both checks now run together as
one standard step (Sep 1-6: removed 176 sign-flips + 30 near-terminal of
2,794; Sep 7-13: removed 215 + 30 of 3,006). `convert_dgd_to_ap.ts` and
`addendum_lagged_activity.ts` were generalized into
`scripts/calibration/shared/{build_ap_series,lagged_activity}.ts`,
parametrized by path instead of hardcoded to Run 1's filenames, so the
same production `computeRecencyWeightedActivity()` reuse pattern now runs
against any window without being copy-pasted per run.

**Phase tagging.** Every epoch is tagged by real DGD-derived phase, not a
flat storm/control binary: `quiet_control` (Sep 1-6), `storm_main` (Sep
8-9), `storm_recovery` (Sep 9-13). Sep 7 (onset) produced no tagged
rate-intervals — it's the first day in the storm pull, so rows anchored
there have no `prev_epoch` within that CSV, and the Sep 6→Sep 7 transition
itself isn't captured by either pull (same edge effect cost Sep 1 its
own rate-intervals in the control window: 6 calendar days of TLE data
yield only 5 control day-blocks, 6 storm day-blocks — thinner than the
nominal window length in both cases, worth remembering when reading the
bootstrap CIs below).

**A methodological finding, before the calibration finding.** Following
Run 1's day_index-as-confound-control design (`perigee_rate ~
activity_tau + day_index`) on the storm window alone produced near-zero,
inconsistently-signed coefficients at every band and τ — an apparent
null result. Checked before trusting it: `activity_tau*h` and `day_index`
correlate at **r = -0.83 (τ=6h) to -0.95 (τ=24h)** within the Sep 7-13
window. Unlike Run 1's original window (which spanned a genuine
quiet→storm transition, so day and ap were correlated but not collinear),
a single storm-recovery arc has "days since onset" and "declining ap" as
mechanistically nearly the same variable. Including both terms doesn't
control for an independent confound here — it mostly cancels the
geomagnetic-recovery signal under test via collinearity, which is a
different failure mode from Run 1's OLS-outlier problem but the same
underlying lesson: an initial specification's null result got checked
before being trusted, per this log's ground rule.

**The day_index decision rule, made predeclared rather than post-hoc.**
The first pass at this run picked "no day_index" as the storm window's
spec after seeing that including it produced a null, and applied that
same choice to the control window "for comparability." That is a
decision made by looking at the result first — the exact failure mode
this log exists to catch. Replaced with a rule that's checked *before*
either coefficient is fit, in `check_daytrend_collinearity.py`:

> `day_index` is not a universal covariate, included or dropped by
> convention. For a given window/band/τ, compute
> `corr(activity_tau*h, day_index)` first. If `|r| >= 0.8` (the
> conventional high-collinearity cutoff — see the script's docstring for
> the VIF correspondence), the two terms are not simultaneously
> identifiable: report the day_index-included spec as a sensitivity
> check only, and treat the no-day_index spec as primary. Below that
> threshold, day_index plausibly captures a background trend separable
> from the exposure: day_index-included is primary, no-day_index is the
> sensitivity check instead.
>
> This must run once per window before either bootstrap script, and its
> output — not a judgment call at write-up time — decides which numbers
> get quoted as primary.

Run against both windows, this rule does not simply confirm "storm:
drop day_index, control: keep it" as a fixed-per-window default. It's
**τ-dependent within the control window too**:

| Window | Band | τ | corr(activity, day_index) | Admissible as primary? |
|---|---|---|---:|---|
| storm | all bands | 6-24h | -0.83 to -0.95 | No — day_index sensitivity-only at every τ |
| control | all bands | 6h | -0.39 to -0.48 | Yes |
| control | all bands | 12h | -0.55 to -0.62 | Yes |
| control | all bands | 18h | -0.72 to -0.76 | Yes |
| control | all bands | 24h | -0.83 to -0.85 | **No** — flips at exactly the same τ the earlier ad hoc comparison ran into trouble |

That last row matters: the control window's own admissibility boundary
sits at the same τ=24h where the earlier same-spec-for-both comparison
found contamination — not a coincidence the rule happens to explain
after the fact, but the rule correctly identifying in advance where a
day_index-included estimate stops being trustworthy for control too.

**Results — primary estimate per band/τ, each window using its own
admissible spec (not one spec applied to both):**

| Band | τ | Storm (primary: no-day_index, inadmissible at every τ) | Control primary spec | Control result |
|---|---|---|---|---|
| 200-250km | 6-18h | -0.04 to -0.06, all null | day_index (admissible) | -0.10 to -0.24, all null |
| 200-250km | 24h | -0.07, null | no-day_index (inadmissible) | +0.05 to +0.26, null |
| **250-300km** | **6h** | **-0.163 [-0.604,-0.082], excludes 0** | day_index (admissible) | **-0.356 [-2.098,-0.011], excludes 0 (p≈0.048, barely)** |
| **250-300km** | **12h** | **-0.179 [-0.677,-0.096], excludes 0** | day_index (admissible) | -0.363 [-4.244,+0.551], **null** |
| **250-300km** | **18h** | **-0.213 [-0.694,-0.121], excludes 0** | day_index (admissible) | -0.419 [-4.398,+1.216], **null** |
| **250-300km** | **24h** | **-0.256 [-0.658,-0.156], excludes 0** | no-day_index (inadmissible) | **+0.791 [+0.175,+1.941], excludes 0 — wrong sign** |
| 300-350km | 6-18h | ~0.00, all null | day_index (admissible) | -0.06 to -0.12, all null |
| 300-350km | 24h | ~0.00, null | no-day_index (inadmissible) | -0.09, null |

**This narrows the clean result further than the first pass reported.**
Using one spec for both windows (the original write-up) called τ=6-18h
in 250-300km the clean range. Using each window's own admissible spec
shows τ=6h is not actually clean: control's own primary estimate there
is *also* negative and *also* excludes zero (barely — the upper CI
bound is -0.011), the same sign as the storm effect, not the neutral
result Phase 7 needs from a quiet window. Whether that's a real
weak effect present even in nominally quiet conditions, a false positive
from 5 thin day-blocks, or noise that happens to land on the wrong side
of a barely-crossed threshold isn't resolvable from this run — but it
should not be folded into "clean." **τ=12h and τ=18h in 250-300km are
the only band/τ combinations where the full requirement holds without
qualification:** storm excludes zero and is correctly signed; control's
own admissible estimate comfortably contains zero.

**Robustness check / cross-run comparison.** The 250-300km storm effect
is correctly signed, survives day-block bootstrap at all four τ, and
grows in magnitude with τ (-0.16 at 6h to -0.26 at 24h) — the same
qualitative pattern Run 1's addendum found. But Run 1's addendum signal
was in the **200-250km** band; this run's signal is in **250-300km**,
and 200-250km itself shows nothing this time. Two single-event results
locating the effect in different altitude bands is not corroboration.

**Conclusion.** Run 2 establishes a promising storm/control contrast at
250-300km for τ=12-18h — a day-block-bootstrap-robust, correctly-signed
effect in the storm window, paired with a genuinely neutral control
estimate at the same τ, each using the spec the predeclared collinearity
rule says is trustworthy for that window. What it cannot establish,
with a single storm event, is whether the altitude-band location or
magnitude of that effect is a reproducible geomagnetic response, rather
than something specific to this one episode — Run 1's addendum located
a comparable-shaped effect one band away, and this run's own τ=6h and
τ=24h results show that "quiet" isn't unambiguously neutral at every τ
either. The day_index collinearity finding explains why the *first*
specification looked like a clean null; it is not, by itself, the
reason a second event is needed — the band mismatch and the τ=6h/24h
edge results are.

**Decision: no change to `lib/geomagneticIndex.ts`.** `GEOMAG_MODEL_VERSION`
stays `0`. Per this run's own explicit non-goals above, a clean
storm-vs-control comparison across the tested τ range is the bar for
touching `GEOMAG_AMPLITUDE`/`GEOMAG_SCALE`/`GEOMAG_POWER`/
`MAX_GEOMAG_MULTIPLIER`, and that bar is cleared at only two of four
tested τ in one of three bands with signal — not enough to calibrate
against. `GEOMAG_DECAY_CONSTANT_HOURS` also stays at its 12h placeholder
— 12h is inside the range that holds cleanly, so this run doesn't argue
for moving it, but doesn't rule out 18h either.

**Next steps for Run 3+:**
- The single real need is **a second genuine G1-or-stronger event**, not
  a larger pull from this one. Sep 15-17 and Aug 27-29 are both
  sub-threshold and belong in a monotonicity check (does response scale
  continuously with forcing), not as a second storm replicate — pooling
  them as if they were equivalent to Sep 8 would reintroduce exactly the
  mis-classification this run corrected before execution.
- **Once there are multiple independent storm events, replace day_index
  entirely rather than trying to rescue it as a covariate.** The right
  structure is event-level, not row-level:
  `y_ijt = β·A_ijt + γ·X_ijt + u_j + ε_ijt`, where `j` indexes the
  geomagnetic event, `u_j` is an event-level random effect, `A_ijt` is
  the lagged-activity exposure, and `X_ijt` is an event-specific
  time/phase term (hours since that event's own onset, not a single
  global day_index) if a within-event trend control is still needed.
  Independent replication then comes from the number of events, not the
  row count within one — closer to this problem's actual structure than
  a shared day_index term ever was.
- Re-run the 250-300km τ-sweep specifically once a second genuine event
  is available — that's the band with the only real signal so far, and
  replication either locates it there again (supports it being real) or
  doesn't (supports the Run 1/Run 2 band disagreement being noise).
- Once a real onset-day TLE gap can be closed (pull control and storm
  windows with one day of overlap instead of adjoining at midnight), the
  onset phase itself becomes analyzable instead of falling into the gap
  between two separately-pulled windows.

---

## Replication check — 2026-10-01 (not a new numbered run)

Not "Run 3": that label is reserved for a run against a second genuine
G1+ event, per Run 2's Next Steps, and no such event has occurred.
This is an opportunistic check using the Sep 18-23 quiet stretch
identified from the Sep 27 DGD pull, run through the identical pipeline
as a second, independent quiet-control replicate (`quiet_control_2`) to
test whether Run 2's control-window edge cases (τ=6h borderline, τ=24h
contamination, both in 250-300km) were real or specific to that window's
thin 5 day-blocks.

**Data quality note — resolved.** The requested pull was Sep 17 through
Sep 26; the returned data stopped at Sep 24, and object count was down
sharply from the Sep 7-13 storm pull (624 -> 440, 212 objects absent,
90% of them last seen in 300-350km -- the slowest-decaying band, the
opposite of what physical reentry would produce). Confirmed cause:
Space-Track.org had a technical outage covering Sep 25-27; ingestion is
back to normal as of this writing. Not a production data-quality defect
-- an upstream source outage, now over. `secondary_active_sep2`
(Sep 24-26) was unusable in this pull for the same reason (only 1 day,
Sep 24, landed); re-pullable now that the source is current again, if
that secondary regime is still wanted for the monotonicity check.

**Collinearity diagnostic generalizes beyond storm-recovery windows.**
Re-running `check_daytrend_collinearity.py` on `quiet_control_2` finds a
*different* admissibility boundary than Sep 1-6's control: admissible
mostly only at τ=6h (r=-0.54 to -0.70), inadmissible by τ=12-18h in most
bands (r=-0.78 to -0.94) -- versus Sep 1-6, which stayed admissible
through τ=18h and only flipped at τ=24h. Different boundary, same
mechanism: Sep 18-23 has its own within-window decline (Kp 3.0 on Sep 20
down to 1.67 by Sep 23), so `activity_tau` and `day_index` go collinear
at long τ there too. This confirms the predeclared-diagnostic approach
(checked per window, not assumed from a "does the window span a phase
transition" heuristic) was the right fix after Run 2 -- a fixed rule
would have gotten this window's admissibility boundary wrong.

**Results, each band/τ using its own admissible primary spec:**

| Band | τ | Primary spec | Result |
|---|---|---|---|
| 250-300km | 6h | day_index (admissible) | +0.048, null |
| 250-300km | 12h | day_index (admissible, r=-0.778) | -0.026, null |
| 250-300km | 18h | no-day_index (inadmissible) | -0.068, null |
| 250-300km | 24h | no-day_index (inadmissible) | -0.074, null |
| 200-250km | 6h | day_index (admissible) | +0.348, null |
| **200-250km** | **12h** | no-day_index (inadmissible) | **+0.617 [+0.283,+1.276], excludes 0, p=0.015 — wrong sign** |
| **200-250km** | **18h** | no-day_index (inadmissible) | **+0.623 [+0.387,+1.375], excludes 0, p=0.010 — wrong sign** |
| **200-250km** | **24h** | no-day_index (inadmissible) | **+0.636 [+0.391,+1.388], excludes 0, p=0.005 — wrong sign** |
| 300-350km | 6-24h | mixed | all null |

**Conclusion.** Mixed, and informative in both directions. 250-300km —
the band carrying Run 2's actual storm signal — replicates clean-null
across all four τ in this independent quiet window, including the two τ
(6h, 24h) that looked shaky in Sep 1-6. That strengthens confidence the
Sep 1-6 edge cases were noise from a thin 5-block sample rather than a
real property of the band, and by extension strengthens Run 2's
τ=12-18h storm-vs-control contrast. 200-250km, conversely, now has three
runs giving three different stories -- a weak signal in Run 1's
addendum, nothing in Run 2's actual storm window, and a strong
wrong-signed "effect" here -- which reads as a noisy band (fewest
objects of the three bands in every pull so far) rather than one
carrying real information. Recommend treating 200-250km results as
unreliable going forward rather than reconciling each run's version of
what it shows.

**Decision: no change.** This isn't a calibration run — no constant was
ever in scope here. Recorded because it changes confidence in Run 2's
existing conclusion, not because it stands alone.

**Next steps:** unchanged from Run 2 — still waiting on a genuine G1+
event for the actual event-pooled Run 3. The Space-Track outage is
resolved, so a re-pull of Sep 24-26 (now complete) would recover
`secondary_active_sep2` for the monotonicity check if wanted, but this
is optional and not a blocker for the primary open item above.

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
