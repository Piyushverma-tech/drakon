# Re-entry Risk Screening

## Overview

Re-entry risk screening identifies orbital objects that are actively decaying and likely to re-enter Earth's atmosphere within a meaningful time window. The feature surfaces these objects on the globe (colored by risk tier), in the RightPanel as a ranked list, and in the LeftPanel when a specific satellite is selected. A dedicated dashboard page at `/dashboard/reentry` provides a full sortable table with filtering, a MiniGlobe preview, and live countdown timers for objects with multi-epoch trend estimates.

The core constraint driving every decision in this feature: **a single TLE epoch contains limited decay information, and most of it is unreliable for maneuvering satellites.**

---

## Two-Layer Screening Architecture

The system uses two complementary screening paths that are resolved together in `lib/objectTrendRisk.ts`:

**Layer 1 — Single-epoch BSTAR screening** (`lib/satelliteHelpers.ts` → `getReentryRisk`)
Uses the BSTAR drag term and mean motion derivative from the current TLE. Fast, synchronous, works for all debris objects with no backend dependency. Accuracy is ±order of magnitude.

**Layer 2 — Multi-epoch trend screening** (`lib/jobs/computeObjectTrends.ts` → `recomputeTrends`)
Uses regression over 7–30 days of historical TLE data stored in `tle_history`. Runs as a background job drained by cron. More reliable for distinguishing genuinely decaying active satellites from maneuvering ones. Accuracy improves with history depth but degrades for terminal objects due to lag.

**Resolution logic** (`lib/objectTrendRisk.ts` → `resolveReentryRisk`):
The two layers are not simply prioritised — the system picks the **more pessimistic** estimate when both are available for sub-threshold objects. This is described in detail in the Resolution Logic section below.

---

## Data Sources

### BSTAR Drag Term (Single-epoch)

Parsed from TLE line 1, columns 53–60 (0-indexed). Uses packed decimal notation: `±NNNNN±N`, representing `0.NNNNN × 10^(±N)`. The leading sign uses a space for positive values. Parsing requires padding to 8 characters before extracting the mantissa and exponent signs.

```
1 25544U 98067A   24001.50000000  .00002182  00000-0  15519-4 0  9993
                                                       ^^^^^^^
                                                       BSTAR field
```

BSTAR is not a direct measurement of drag — it is a least-squares fitting coefficient that absorbs actual drag, maneuver residuals, and tracking errors. For non-maneuvering objects it converges toward the true drag coefficient over successive updates. For maneuvering satellites it is essentially meaningless for decay prediction.

### Mean Motion Derivative Ṅ (Single-epoch)

Parsed from TLE line 1, columns 33–42 (0-indexed). Used as a secondary confidence signal. Positive Ṅ definitively indicates a decaying orbit. Less contaminated by maneuvers than BSTAR across a tracking arc.

### TLE History (Multi-epoch)

Stored in `tle_history` (Neon PostgreSQL, partitioned monthly by epoch). Accumulated on Redis cache miss via `lib/jobs/ingestTleHistory.ts`. Provides per-object time series of BSTAR, mean motion, mean motion dot, perigee, apogee, and semi-major axis going back up to 30 days.

A GitHub Actions workflow fires every 2 hours to hit `/api/tle`, ensuring the Redis cache is refreshed and ingest runs regardless of user traffic:

```yaml
# .github/workflows/tle-ping.yml
on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch:
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Fetch TLE and trigger ingest pipeline
        run: curl --max-time 900 -X GET "https://drakon-orbital.vercel.app/api/tle"
```

### NOAA F10.7 Solar Flux

Fetched daily from `https://services.swpc.noaa.gov/json/f107_cm_flux.json` and cached in Upstash Redis under `solar:f107` with a 24h TTL. Exposed to the client via `x-f107` and `x-solar-flux-multiplier` response headers on `/api/tle`. Applied as a density multiplier to all decay rate calculations.

The solar flux multiplier formula:

```
CALIBRATION_MULTIPLIER = (200 / 150)^1.5  ≈ 1.54
multiplier = CALIBRATION_MULTIPLIER × (F10.7 / 200)^0.3
```

The exponent is 0.3 (not 1.5) to avoid over-penalising observed flux (~125 sfu) relative to the calibration value of 200. At solar minimum (~70 sfu) this yields ~0.88×; at solar maximum (~250 sfu) ~1.14×. The formula is intentionally conservative to avoid false upgrades during quiet periods.

---

## Single-Epoch Decay Rate Formula

### Derivation

BSTAR has units of `(Earth radii)⁻¹`. The altitude decay rate is derived from the two-body energy relation combined with the SGP4 drag model:

```
da/dt = -2 × B* × ρ_ref × R_earth × v  [Earth-radii per second]
```

Simplified to km/day for screening purposes with scale height and solar flux corrections:

```
decayRate (km/day) = |BSTAR| × BASE_FACTOR × densityFactor × (v / v_ref) × solarFluxMultiplier
```

Where:

- `BASE_FACTOR = 7.4e3` — calibrated for parsed TLE BSTAR values
- `densityFactor = exp((400 - altKm) / 60)` — exponential scale height correction, H = 60 km
- `v_ref = 7.905 km/s` — circular velocity at sea level
- `v = sqrt(MU / (R_earth + alt))` — current orbital velocity
- `solarFluxMultiplier` — NOAA F10.7-derived density scaling (default ~1.54 at calibration flux of 200 sfu)

### Scale Height Rationale

Atmospheric density approximately halves every 60 km in the 200–600 km range. The `exp((REF_ALT - alt) / H)` term corrects for this. Without it, objects at 500 km would appear to decay as fast as objects at 300 km, which is physically wrong.

### Lifetime Estimate

```
estimatedDays = ceil(((perigeeKm - 120) / decayRate) × 2/3)
```

120 km is the nominal re-entry threshold. The lifetime estimate uses perigee rather than mean altitude because re-entry is driven by the low point of the orbit. The 2/3 multiplier approximates accelerating drag as altitude falls. `ceil` is used to avoid displaying `~0d` for objects with hours remaining.

### Altitude-Based Fallback for Sub-300 km Objects

For objects below the altitude threshold (300 km for debris, 240 km for active payloads), an additional altitude-based estimate is computed from an exponential scale height model calibrated to NRLMSISE-00 midpoints:

```typescript
// lib/satelliteHelpers.ts → estimateDecayRateFromAltitude
BASE_RATE_200KM = 10 × solarFluxMultiplier   // km/day at 200 km
SCALE_HEIGHT = 35 km                          // tighter in lower thermosphere
decayRate = BASE_RATE_200KM × exp((200 - altKm) / 35)
```

This model is independent of BSTAR and captures the physical reality that at very low altitudes atmospheric drag overwhelms any BSTAR uncertainty. It is used as the primary estimate for sub-threshold objects when BSTAR is unavailable or anomalous, and as a cross-check against the multi-epoch trend estimate.

---

## Multi-Epoch Trend Computation

### Regression

The trend worker (`lib/jobs/computeObjectTrends.ts`) runs linear regression over 7/14/30-day windows for BSTAR, perigee, apogee, semi-major axis, and mean motion dot. Regression uses **exponential weighting** so recent epochs dominate over historical ones:

```typescript
weight = exp((epochMs - nowMs) / halfLifeMs);
```

Half-life is altitude-dependent:

- `perigeeLatest < 250 km` (terminal): **1-day half-life** — last 24h epochs weighted ~8× more than week-old ones
- All other objects: **3-day half-life**

This replaces the previous unweighted regression that caused 7–8 day over-estimates for terminal decay objects by averaging a slowly-decaying historical period against the accelerating final descent.

### Decay Classification

```typescript
rawConfidence = 0.35 × bstarSignal + 0.25 × ndotSignal + 0.40 × altitudeSignal
decayConfidence = rawConfidence × (1 − maneuverLikelihood × 0.75)
```

Signal strengths are derived from regression slope quality (R² × normalised slope magnitude). Maneuver likelihood is computed from BSTAR coefficient of variation — high variance without corresponding altitude drop indicates propulsion.

Decay signals:

| Signal              | Condition                                                            |
| ------------------- | -------------------------------------------------------------------- |
| `decaying`          | `decayConfidence ≥ 0.35` and altitude or joint BSTAR+N-dot agreement |
| `maneuvering`       | High BSTAR CV without altitude decay                                 |
| `stable`            | Low confidence with ≥5 epochs                                        |
| `insufficient_data` | Fewer than 3 epochs or less than minimum history span                |

Minimum history requirements: 1 day for debris, 7 days for active payloads.

### Re-entry Estimate from Trends

Decay rate uses the **pessimistic-of-7d-and-14d** slopes:

```typescript
decayRateKmPerDay = max(
  abs(perigeeSlope7d)  if negative,
  abs(smaSlope7d)      if negative,
  abs(perigeeSlope14d) if negative,
  abs(smaSlope14d)     if negative
)
estimatedDays = max(1, ceil(((perigeeLatest - 120) / decayRateKmPerDay) × 2/3))
```

The 7-day slope is preferred for terminal objects because decay is accelerating — the recent slope is more representative than the longer-window average. The `max()` across both windows prevents the 14-day average from masking a steeper recent trend.

### Payload Consensus Gate

Active payloads require all three signal classes to agree before a non-stable tier is assigned:

```
BSTAR slope positive AND N-dot indicates decay AND perigee/SMA slope negative
```

Exceptions: below 220 km perigee, altitude drop alone is sufficient (drag overwhelms maneuver authority). Between 220–300 km, altitude agreement alone suffices (partial consensus).

### Confidence Ceiling

High estimated days can be downgraded if trend confidence is low:

```typescript
if (confidence < 0.75): critical/warning → nominal
if (confidence < 0.85): critical → warning
```

This prevents low-confidence trends from triggering critical alerts.

---

## Resolution Logic (`resolveReentryRisk`)

`lib/objectTrendRisk.ts` combines both layers into a single `ReentryRisk` for each object:

```
resolveReentryRisk(entry, trend?, solarFluxMultiplier)
```

### Step 1 — HEO gate

Objects with `apogeeKm > perigeeKm × 10 AND apogeeKm > 2000` are returned as stable. HEO objects spend most of their orbit outside the atmosphere; their low perigee is misleading.

### Step 2 — Altitude override (sub-threshold objects)

For `perigeeKm < altThreshold` (300 km debris / 240 km payloads):

1. **Raising orbit check**: if `nDot < -1e-6` (orbit raising) or BSTAR negative with negative N-dot → stable
2. **Trend maneuvering check**: if trend shows `decaying = 'maneuvering'` or `stable` with ≥5 epochs → stable
3. **Eccentricity correction**: for moderately eccentric orbits (`apogeeKm > perigeeKm × 3 AND apogeeKm > 500`), apply `perigeeKm / apogeeKm` factor to avoid over-estimating decay for objects that only briefly dip low
4. **Compute altitude-based estimate** via `altitudeBasedReentryEstimate`, scaled by 0.8
5. **Pessimistic-of-two**: if an actionable trend exists and its `estimatedDaysRemaining` is **lower** than the altitude estimate, use the trend result. Otherwise use the altitude-based result.

This means for a Starlink at 190 km with both a 2-day altitude estimate and a 9-day trend estimate, the altitude-based 2-day result wins. If the trend somehow shows 1 day (weighted regression caught accelerating decay faster), the trend result wins.

### Step 3 — Standard multi-epoch path (perigee ≥ threshold)

For objects above the altitude threshold:

- If trend is actionable (`epochsAvailable ≥ 3`, `historyDaysAvailable ≥ 1`, `decaySignal ≠ 'insufficient_data'`):
  - Debris: use trend directly
  - Active payload: require `decaySignal === 'decaying'` AND all three signals agree
- If no actionable trend and debris: fall back to single-epoch `getReentryRisk`
- If no actionable trend and active payload: return stable

### Decision flowchart

```
resolveReentryRisk(entry, trend)
  │
  ├─ HEO? → stable
  │
  ├─ perigeeKm < altThreshold?
  │   ├─ raising orbit / negative BSTAR+nDot? → stable
  │   ├─ trend shows maneuvering/stable (≥5 epochs)? → stable
  │   ├─ compute altEstimate (altitude-based)
  │   ├─ trend actionable AND trend.days < alt.days? → use trend
  │   └─ else → use altEstimate
  │
  └─ perigeeKm ≥ altThreshold
      ├─ actionable trend?
      │   ├─ debris → objectTrendToReentryRisk(trend)
      │   └─ payload → allSignalsAgree? → objectTrendToReentryRisk(trend) : stable
      ├─ debris, no trend → getReentryRisk(entry) [single-epoch]
      └─ payload, no trend → stable
```

---

## Object Classification Filter

### Debris classification

Only objects classified as debris are eligible for single-epoch BSTAR screening:

```typescript
const isDebrisObject =
  entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');
```

`entry.isDebris` is set upstream in `lib/tle.ts` → `parseTleText` for names containing `r/b`, `rkt`, `rocket`, `platform`. This means rocket bodies are included. The check in `getReentryRisk` does not duplicate name-based classification to avoid split logic.

Active payloads can only be screened via multi-epoch trends with full signal consensus. This filters the Starlink DTC false positive case: operational satellites at 367 km with maneuver-contaminated BSTAR no longer appear as critical.

### Additional sanity gates (single-epoch)

```typescript
// GEO / deep space
if (periodMin > 600 || perigeeKm > 2000) → stable

// No meaningful computed decay
if (decayRateKmPerDay < 1e-4) → stable

// Altitude-aware anomaly cap
if (decayRateKmPerDay > maxPlausibleDecayRateKmPerDay(altKm)) → stable

// Beyond screening horizon
if (rawDays > 3650) → stable
```

The anomaly cap is altitude-aware:

- Below 180 km: cap disabled (terminal decay can legitimately exceed any fixed rate)
- 180–400 km: tight cap `8 × exp((300 - alt) / 60)` km/day, minimum 0.5 km/day
- Above 400 km: `20 × exp((400 - alt) / 60)` km/day

The old flat 20 km/day cap is gone. It suppressed legitimate terminal decay signals below ~200 km.

---

## Risk Tiers

| Tier     | Condition                                  | Globe color                     |
| -------- | ------------------------------------------ | ------------------------------- |
| Critical | < 30 days                                  | Red-orange `[255, 60, 40, 230]` |
| Warning  | Above critical, below altitude-aware limit | Amber `[255, 160, 30, 210]`     |
| Nominal  | Above warning, below altitude-aware limit  | Yellow `[255, 220, 80, 180]`    |
| Stable   | Beyond limit, null, or filtered out        | Not shown in re-entry mode      |

Critical cutoff stays fixed at 30 days regardless of altitude. Warning/nominal limits compress at higher altitudes where single-epoch BSTAR is less reliable:

| Altitude | Warning limit | Nominal limit |
| -------- | ------------- | ------------- |
| ≤ 300 km | 180 days      | 365 days      |
| 500 km   | 120 days      | 240 days      |
| 800 km   | 90 days       | 180 days      |
| 1000 km  | 60 days       | 120 days      |
| 2000 km  | 45 days       | 90 days       |

### N-dot Confidence Signal

The positive Ṅ threshold is altitude-dependent because fit noise dominates at higher altitudes:

| Altitude   | Threshold              |
| ---------- | ---------------------- |
| ≤ 400 km   | `nDot > 1e-5 rev/day²` |
| 400–500 km | `nDot > 2e-5 rev/day²` |
| > 500 km   | `nDot > 5e-5 rev/day²` |

Agreement raises confidence to `high`. Without agreement: `medium` below 500 km, `low` above 500 km. Confidence affects the displayed label and the confidence ceiling downgrade, but does not change tier thresholds directly.

---

## Performance Design

### Single-epoch path: no worker, no async

`getReentryRisk` runs entirely in a `useMemo` over `entries[]` — synchronous, sub-millisecond for 15k objects. The formula is arithmetic only: one square root, one exponential, handful of multiplications per object.

### Dependency isolation

```typescript
const reentryRisks = useMemo(() => {
  if (!showReentry) return new Map();
  return buildReentryRiskMap(entries, objectTrendsById, solarFluxMultiplier);
}, [showReentry, entries, objectTrendsById, solarFluxMultiplier]);
// NOT activeSatellites
```

`activeSatellites` is deliberately excluded. Re-entry risk is derived from static TLE parameters, not live SGP4 positions. Including `activeSatellites` would cause recomputation every 5 seconds on the position update cycle, causing freezes at 15k objects.

### Ref pattern for layer closure

`reentryRisks` is excluded from the `layers` useMemo dependencies. A ref keeps the `getFillColor` closure current without triggering layer recomputation:

```typescript
const reentryRisksRef = useRef(reentryRisks);
useEffect(() => {
  reentryRisksRef.current = reentryRisks;
}, [reentryRisks]);

// Inside getFillColor:
const risk = reentryRisksRef.current.get(d.id);
```

### Trend data: lazy fetch, 30-minute stale time

`useObjectTrendsQuery` is only enabled when `showReentry === true`. The GlobeContainer does not block rendering on trends — single-epoch results appear immediately, trends refine in the background when the query resolves.

---

## Trend Pipeline Operations

### Ingest

`lib/jobs/ingestTleHistory.ts` runs as an `after()` callback on every `/api/tle` cache miss. Per chunk of 500 entries:

1. Insert new epochs into `tle_history` with `onConflictDoNothing` on `(norad_id, epoch)`
2. Archive raw TLE lines to `tle_archive` for newly inserted epochs only
3. Enqueue `trend_jobs` for NORAD IDs with new epochs

Terminal priority requeue: objects currently below 250 km perigee delete their existing pending job and re-insert unconditionally, so the trend worker always has a fresh job for the most time-critical objects regardless of whether their TLE epoch changed.

### Worker

`POST /api/internal/process-trends?batchSize=200` — called by cron-job.org every 15 minutes.

At the top of each invocation, `processing` rows are deleted (stuck-job cleanup). Jobs are claimed with `FOR UPDATE SKIP LOCKED`, processed concurrently in slices of 10 via `Promise.allSettled`, and deleted on success. Failed jobs increment `retry_count`; after 3 retries status becomes `failed`.

### Version invalidation

Bump `CURRENT_TREND_VERSION` in `lib/jobs/computeObjectTrends.ts` when the regression algorithm or confidence formula changes. The `requeueStaleObjects` function only requeues objects where **both** conditions hold:

1. `trend_version < CURRENT_TREND_VERSION`
2. New `tle_history` epochs exist since the trend's `updated_at`

This prevents a version bump from flooding the queue with 18k jobs when the underlying history hasn't changed.

### Scheduling summary

| Job                | Trigger                                            | Schedule      | Timeout |
| ------------------ | -------------------------------------------------- | ------------- | ------- |
| TLE ingest         | GitHub Actions → GET `/api/tle`                    | Every 2 hours | 900s    |
| Solar flux refresh | cron-job.org → POST `/api/solar-flux`              | Daily         | 10s     |
| Trend processing   | cron-job.org → POST `/api/internal/process-trends` | Every 15 min  | 60s     |

---

## Explainability Layer

`lib/explainReentryTrend.ts` is the single source of truth for turning regression output into a classification — extracted from `computeObjectTrends.ts` specifically so the trend worker and the read-side API routes can never compute two different answers for the same object. It exports:

- `classifyDecaySignal` / `estimateReentry` — the same functions the worker calls (unchanged behavior, pure refactor).
- `SIGNAL_WEIGHTS` / `SIGNAL_AGREE_THRESHOLDS` — named constants (0.35 / 0.25 / 0.4 weights, 0.3 / 0.3 / 0.2 agreement thresholds) instead of inline magic numbers, so any consumer reconstructing a signal breakdown uses the exact same numbers the classifier used.
- `reconstructSignalContributions(scores)` — rebuilds a `SignalContribution[]` (per-signal strength, weight, contribution, agreement) from the three persisted `object_trends` columns below, **without** re-querying `tle_history` or re-running regressions. This is what makes the read-side (`/explain`, the Analysis page) cheap and guaranteed-consistent with what was actually computed, rather than a live re-derivation that could drift.

`object_trends` persists three additional columns for this purpose: `bstar_signal_strength`, `ndot_signal_strength`, `altitude_signal_strength` (all nullable — `null` for rows written before this was added, until their next recompute; `reconstructSignalContributions` returns an empty array rather than fabricate a value in that case), plus `consensus_required` / `consensus_met`.

---

## Decision Trace (Analysis Page)

`/dashboard/reentry/[noradId]` — every object with a resolved risk gets a dedicated page answering "why," not just "what."

**Verdict is computed from `risk`, not `trend`, directly.** `buildReentryTrace()` (in `app/dashboard/reentry/[noradId]/lib/buildReentryTrace.ts`) takes the same `{ risk, trend }` pair the dashboard already computes via `resolveReentryRisk()` — not a second, independent server-side computation. This was a deliberate fix: an earlier version read the verdict straight from the persisted `object_trends` row, which meant the Analysis page could show a different (staler, less pessimistic) tier than the Detail Panel for the same object below the altitude threshold, since it never applied the live-altitude pessimistic-merge. Reusing the exact same `risk` object the rest of the app renders makes that class of drift structurally impossible, not just less likely.

**One-line summary.** `buildReentryTrace()` also composes a synthesized analytical sentence (`verdict.summary`) — a characterization clause (what's happening: sustained decay with all signals agreeing, a borderline signal, a live-altitude override ahead of the trend model, a probable maneuver, etc.) plus an evidentiary clause (epoch count, the estimate, and confidence in prose — `"moderate"`/`"high"`/`"low"`, a deliberately different register from the precise percentage shown elsewhere on the page). Always present, for every tier — shown before the "Show decision trace" toggle so the read order is verdict → summary → evidence on demand.

**The trace itself renders as a connected pipeline**, not a flat checklist — each `TraceStep` is a circular icon node joined to the next by a vertical connector line, with a small uppercase stage label (`Load history`, `Bstar analysis`, `N-dot analysis`, `Altitude analysis`, `Consensus`, `Live override`, `Verdict`) above the actual claim. Steps are generated in this order by `buildReentryTrace()`:

1. **Load history** — epoch count and days of history (only when a `trend` row exists)
2. **Bstar / N-dot / Altitude analysis** — one step per `SignalContribution`, from `reconstructSignalContributions`
3. **Consensus** — full/partial/none, and whether it was met
4. **Verdict** — the tier assignment itself
5. **Live override** — only present when `trend.reentryTier !== risk.tier`, explicitly stating the trend model's own number alongside the live one so the disagreement is legible, not silently swapped

**Evidence** (always visible, not gated by the trace toggle): altitude-decay and BSTAR-trend charts (ECharts, `components/Charts/`, fed by `/api/object-trends/[noradId]/history`), and a change-history timeline (below).

---

## Triage & Change History

`trend_snapshots` is an append-only log, written by `upsertTrend()` in `computeObjectTrends.ts` only when an object's `reentryTier` or `decaySignal` actually differs from what was persisted before the write — not on every recompute. This is what makes "what changed recently" answerable without diffing the whole catalog on every page load.

**Dashboard triage** (`app/dashboard/reentry/lib/buildTriageBuckets.ts`) groups flagged objects into three buckets using each object's two most recent snapshots (`/api/object-trends/recent-changes`, one unscoped window-function query across the whole table):

- **New / escalated** — the most recent snapshot is within a 72-hour window _and_ represents an actual severity increase (or is the object's first-ever snapshot). A recent _improvement_ does not qualify — it falls back to grouping by current tier, so good news isn't surfaced with the same urgency as bad news.
- **Active** — current tier is critical/warning, nothing changed recently.
- **Watching** — current tier is nominal, stable.

**Change-history timeline** (Analysis page, `app/dashboard/reentry/[noradId]/lib/buildChangeTimeline.ts`, backed by `/api/object-trends/[noradId]/snapshots` — up to the 20 most recent snapshots for one object) turns consecutive snapshot pairs into readable events: **escalated** (tier got worse), **improved** (tier got better), **lateral** (decay signal changed, tier didn't — e.g. `decaying` → `maneuvering` while staying `warning`), and **first** (the oldest entry in the returned window — captioned as such, not implied to be the object's true first-ever classification if the 20-row cap was hit).

---

## UI Surfaces

| Surface                        | What it shows                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Globe ScatterplotLayer         | Objects colored by tier when `showReentry` active; non-flagged objects dimmed to `[60, 60, 80, 100]`                                      |
| RightPanel                     | Tier counts, top-50 list sorted by `estimatedDaysRemaining`, link to dashboard                                                            |
| LeftPanel                      | Re-entry detail section for focused satellite; `multi_epoch` source accent on Signal row                                                  |
| `/dashboard/reentry`           | Triage tabs (New/Escalated · Active · Watching), sortable/filterable table per tab, MiniGlobe preview, ReentryStatsBar with F10.7 display |
| `/dashboard/reentry/[noradId]` | Decision Trace: one-line summary, connected-pipeline reasoning trace, evidence charts, change-history timeline                            |

The dashboard re-entry table links each row to its Analysis page ("Full analysis"); the Analysis page's own "Track object" action jumps to the globe with that satellite focused.

---

## Accuracy Expectations

| Scenario                                | Expected accuracy                                                          |
| --------------------------------------- | -------------------------------------------------------------------------- |
| Debris, single-epoch, 150–250 km        | ±1–2 days (altitude-based model reliable)                                  |
| Debris, multi-epoch, accelerating decay | ±2–4 days (weighted regression, 7d slope)                                  |
| Active payload, multi-epoch, 250–600 km | ±order-of-magnitude (consensus gate adds reliability but history is short) |
| Any object, > 600 km                    | Very low — single-epoch BSTAR is dominated by fit noise                    |

Factors not modelled:

- Geomagnetic storms (short-term density spikes of days)
- Object attitude and tumbling (effective drag cross-section varies)
- Full orbital eccentricity (formula assumes near-circular)
- NRLMSISE-00 full density profile (uses exponential scale height approximation)

---

## Files

| File                                                 | Role                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/satelliteHelpers.ts`                            | `parseBSTAR`, `parseMeanMotionDot`, `getReentryRisk`, `altitudeBasedReentryEstimate`, `estimateDecayRateFromAltitude`, `assignReentryTier`, `applyConfidenceCeiling`, `ndotIndicatesDecay`, `getReentryTierThresholds` |
| `lib/objectTrendRisk.ts`                             | `resolveReentryRisk`, `objectTrendToReentryRisk`, `buildReentryRiskMap`, `isActionableTrend`                                                                                                                           |
| `lib/explainReentryTrend.ts`                         | `classifyDecaySignal`, `estimateReentry`, `reconstructSignalContributions`, `SIGNAL_WEIGHTS`, `SIGNAL_AGREE_THRESHOLDS`                                                                                                |
| `lib/reentrySignals.ts`                              | `allTrendSignalsAgree`, `trendSignalsAgree`, `allSignalsAgreeFromSlopes`, `decaySignalFlags`, `isDebrisEntry`                                                                                                          |
| `lib/solarFlux.ts`                                   | `solarFluxMultiplierFromF107`, `getSolarFlux`, `refreshSolarFluxInRedis`, `pickDailyF107`                                                                                                                              |
| `lib/jobs/computeObjectTrends.ts`                    | `recomputeTrends`, `processTrendJobs`, `upsertTrend` (writes `object_trends` + conditionally `trend_snapshots`), `regression`, `weightedRegression`, `slopeOverWindowWeighted`                                         |
| `lib/jobs/ingestTleHistory.ts`                       | History + archive writes (concurrent chunk processing, `CHUNK_CONCURRENCY=4`), per-chunk job enqueue, terminal priority requeue                                                                                        |
| `lib/jobs/requeueStaleObjects.ts`                    | Version invalidation sweep with new-history guard                                                                                                                                                                      |
| `lib/visualization-slice.ts`                         | `showReentry` state, `setShowReentry` action                                                                                                                                                                           |
| `hooks/useObjectTrendsQuery.ts`                      | Client trends fetch, enabled only when `showReentry`                                                                                                                                                                   |
| `hooks/useObjectExplainQuery.ts`                     | `/explain` fetch — standalone trend-model reasoning, independent of the Analysis page's own `risk`+`trend` trace                                                                                                       |
| `hooks/useObjectHistoryQuery.ts`                     | `/history` fetch for evidence charts                                                                                                                                                                                   |
| `hooks/useObjectSnapshotsQuery.ts`                   | `/snapshots` fetch for the change-history timeline                                                                                                                                                                     |
| `hooks/useRecentTrendChangesQuery.ts`                | `/recent-changes` fetch for dashboard triage                                                                                                                                                                           |
| `app/dashboard/reentry/`                             | Dashboard page (triage tabs), table, detail panel, stats bar, countdown, navigation                                                                                                                                    |
| `app/dashboard/reentry/lib/buildTriageBuckets.ts`    | New/escalated · active · watching classification                                                                                                                                                                       |
| `app/dashboard/reentry/[noradId]/`                   | Analysis page: `buildReentryTrace.ts`, `buildReentryChartOptions.ts`, `buildChangeTimeline.ts`, `formatTimestamp.ts`                                                                                                   |
| `components/DecisionTrace/`                          | Generic Verdict → Trace → Evidence shell (`DecisionTrace`, `TraceStep`) — not re-entry-specific, intended for reuse by future modules                                                                                  |
| `components/Charts/`                                 | EChart wrapper + theme, shared by the Analysis page's evidence charts                                                                                                                                                  |
| `app/api/solar-flux/route.ts`                        | GET: read from Redis; POST: refresh from NOAA                                                                                                                                                                          |
| `app/api/object-trends/route.ts`                     | Read-only bulk trend fetch for client                                                                                                                                                                                  |
| `app/api/object-trends/[noradId]/history/route.ts`   | Raw `tle_history` time series for one object                                                                                                                                                                           |
| `app/api/object-trends/[noradId]/explain/route.ts`   | Persisted trend-model reasoning for one object, via `reconstructSignalContributions`                                                                                                                                   |
| `app/api/object-trends/[noradId]/snapshots/route.ts` | Up to 20 most recent `trend_snapshots` rows for one object                                                                                                                                                             |
| `app/api/object-trends/recent-changes/route.ts`      | Latest 1-2 snapshots per object, catalog-wide, for dashboard triage                                                                                                                                                    |
| `app/api/internal/process-trends/route.ts`           | Worker drain endpoint                                                                                                                                                                                                  |
| `app/api/internal/requeue-stale/route.ts`            | Version invalidation requeue                                                                                                                                                                                           |
| `.github/workflows/tle-ping.yml`                     | 2-hour GitHub Actions cron for TLE ingest                                                                                                                                                                              |

---

## Related Documentation

- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [TLE History Pipeline](./TLE_HISTORY_PIPELINE.md)
- [README — Performance Optimizations](../README.md#performance-optimizations)
