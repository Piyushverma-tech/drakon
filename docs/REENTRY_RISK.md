# Re-entry Risk Screening

## 1. Purpose and scope

DRAKON's re-entry screening subsystem identifies catalog objects whose tracked orbit is undergoing atmospheric decay and produces a time-to-re-entry estimate when the available evidence is sufficient. The subsystem is intentionally a screening system rather than a high-fidelity atmospheric re-entry propagator. Its primary objective is to turn sparse and noisy TLE-derived observations into a conservative, explainable operational signal while avoiding false positives from maneuvering spacecraft and malformed or poorly fitted drag parameters.

The implementation combines two fundamentally different evidence paths:

1. A fast single-epoch screen derived directly from the current TLE. This path is inexpensive and is primarily useful for debris objects for which BSTAR is reasonably interpretable.
2. A multi-epoch trend model derived from stored TLE history. This path evaluates changes over time in BSTAR, mean-motion derivative, and orbital altitude and is the preferred source of evidence when sufficient history exists.

A third, independent data product is the U.S. Space Force Space-Track TIP feed. TIP is not used to overwrite DRAKON's estimate. Instead, an available TIP prediction is attached to the screening result as an external reference and is exposed to the UI for comparison.

The authoritative implementation is the code under `lib/`, `app/api/`, and `app/dashboard/reentry/`. This document describes the behavior currently implemented on `main`.

## 2. Design goals

The subsystem is designed around the following engineering goals:

- Prefer multiple independent orbital signals over a single noisy parameter.
- Treat active payloads differently from debris because maneuvering spacecraft can invalidate BSTAR-based conclusions.
- Keep the fast screening path independent of database access so the globe can evaluate many objects without waiting for background analytics.
- Move historical regression work out of the request path and into a persistent job queue.
- Make the worker and read-side resolution logic use the same classification primitives so the UI does not implement a second interpretation of the model.
- Preserve enough intermediate signal strength and history metadata to explain why an object was classified as decaying, stable, or maneuvering.
- Degrade conservatively when data is stale, insufficient, inconsistent, or unavailable.
- Keep external TIP and solar-flux data operationally independent from the core DRAKON estimate.

## 3. System architecture

At a high level, the subsystem is divided into ingestion, historical storage, asynchronous trend computation, risk resolution, external reference data, and presentation layers.

```text
                    TLE providers
                 /                 \
        Space-Track / CelesTrak    CelesTrak debris groups
                 \                 /
                  \               /
                   TLE ingestion service
                          |
                +---------+---------+
                |                   |
             Redis              PostgreSQL
        current TLE snapshot     |
        + stale fallback         +--> tle_history
                                  +--> tle_archive
                                  +--> trend_jobs
                                  +--> object_trends
                                  +--> trend_snapshots
                                          |
                                  asynchronous worker
                                          |
                               explainReentryTrend()
                                          |
                                  persisted trend result

Current TLE + object trend + solar flux
                  |
          resolveReentryRisk()
                  |
          ReentryRisk map
                  |
       Dashboard / Globe / Detail

Space-Track TIP --------------------> Redis ---> optional comparison data
NOAA F10.7 --------------------------> Redis ---> decay-rate multiplier
```

The architecture deliberately separates computation that must happen during rendering from computation that can be delayed. The current TLE is a request-time dependency; historical regression is a background-data dependency.

## 4. Data model

The subsystem uses four PostgreSQL tables for historical and derived state.

### 4.1 `tle_history`

`tle_history` is the time-series source for trend computation. Each accepted TLE epoch becomes one row identified by `(norad_id, epoch)`. The table is partitioned monthly by epoch in the database migration layer.

Stored values include:

- BSTAR
- mean motion
- mean-motion derivative (N-dot)
- eccentricity
- inclination
- RAAN
- argument of perigee
- mean anomaly
- perigee altitude
- apogee altitude
- semi-major axis
- ingestion timestamp
- source group

Orbital geometry is derived once from the TLE during ingestion and persisted. Trend computation therefore does not repeatedly reconstruct the same geometry from raw TLE lines.

The worker only reads a rolling 30-day window from this table.

### 4.2 `tle_archive`

`tle_archive` preserves raw TLE line 1 and line 2 for a small number of recent epochs per object. The ingestion path currently retains the newest three archived epochs per object. This table exists primarily for provenance and inspection rather than regression.

### 4.3 `object_trends`

`object_trends` is a one-row-per-NORAD derived cache owned by the trend worker. It contains the latest regression outputs, signal strengths, classification, confidence, consensus state, and re-entry estimate.

The row also records `trendVersion`. The current implementation uses `CURRENT_TREND_VERSION = 4`. Changing the regression or classification algorithm requires bumping this version so previously computed results can be recognized as stale.

Important persisted fields include:

- history coverage: epoch count and history duration
- 7/14/30-day BSTAR slopes and 14-day distribution statistics
- 7/14/30-day perigee slopes
- 14-day apogee slope
- 7/14-day semi-major-axis slopes
- latest and 14-day mean N-dot
- decay signal
- maneuver likelihood
- aggregate decay confidence
- individual BSTAR, N-dot, and altitude signal strengths
- consensus requirement and whether it was met
- estimated days remaining and estimated re-entry time
- re-entry tier
- object type and debris classification

### 4.4 `trend_jobs`

`trend_jobs` is a lightweight persistent work queue. Jobs are created for newly inserted history epochs and for priority terminal-decay objects. Completed jobs are deleted rather than retained with a `done` status.

The queue prevents historical regression from blocking TLE ingestion or dashboard rendering. Pending jobs are protected from duplicate insertion by a partial uniqueness constraint on NORAD ID.

### 4.5 `trend_snapshots`

`trend_snapshots` is an append-only change log. A snapshot is written when an object's persisted `reentryTier` or `decaySignal` changes. The resulting history supports triage and object-level change timelines without storing a full copy of every regression result.

## 5. TLE ingestion and history generation

The public `/api/tle` endpoint does not perform provider ingestion. It serves the current Redis snapshot.

The ingestion entry point is `POST /api/internal/ingest-tle`, protected by `INTERNAL_JOB_SECRET`. The endpoint calls `runIngestionCycle()` in `lib/ingestion/tleIngestionService.ts`.

The ingestion cycle has several important properties.

### 5.1 Provider selection and fallback

The configured primary provider is queried first. If it fails, the configured fallback provider is used for the active catalog. The cycle records which provider actually supplied the data.

Static debris clouds are fetched independently from CelesTrak on every ingestion cycle:

- Iridium 33 debris
- Cosmos 2251 debris
- Fengyun-1C debris

These groups are health-checked independently. Each has a minimum expected population. A degraded group prevents the cycle from treating missing objects as authoritative deletions.

### 5.2 Redis snapshot merge

The fetched TLEs are merged into the existing Redis snapshot rather than blindly replacing it. This matters for windowed provider responses and for provider fallback.

Two Redis values are maintained:

- `tle:combined`: current snapshot with a TTL
- `tle:combined:stale`: last successfully assembled snapshot without the same expiry behavior

The `/api/tle` endpoint serves the current snapshot when present and falls back to the stale snapshot when the primary key is empty. If neither exists, it returns HTTP 503.

### 5.3 Full resynchronization and pruning

A full resynchronization is eligible once per 24 hours, but pruning is deliberately more restrictive than fetching. A cycle may remove objects from the current snapshot only when all of the following are true:

- a full resync is due;
- Space-Track was the provider actually used for the primary catalog;
- the cycle did not use an unplanned fallback; and
- all static debris groups passed their health floors.

This prevents a partial or narrower CelesTrak response from being interpreted as proof that an object has disappeared from the catalog.

### 5.4 History ingestion

Primary-provider entries and static-debris entries are passed to `ingestTleHistory()` separately so `source_group` remains correct.

The history writer processes entries in chunks of 500, with up to four chunks processed concurrently. Invalid epochs and non-positive mean-motion records are rejected. Objects with clearly stable geometry are excluded from historical decay analysis when their period is greater than 600 minutes, perigee is above 2000 km, or they satisfy the HEO geometry gate.

New `(NORAD ID, epoch)` pairs are inserted with conflict-ignore semantics. Newly inserted rows create trend jobs.

Objects with perigee below 250 km receive priority treatment: their pending trend job is replaced/recreated so terminal objects continue to receive fresh trend computation even when the provider does not emit a new epoch every cycle.

## 6. Historical trend computation

Historical computation is implemented in `lib/jobs/computeObjectTrends.ts`.

The worker reads up to 30 days of `tle_history` for one object. A trend is not considered actionable unless at least three epochs are available and the required minimum history duration has been reached:

- debris / rocket bodies: at least 1 day
- payloads / other non-debris objects: at least 7 days

Objects below these requirements are persisted as `insufficient_data` with a stable re-entry tier rather than being silently omitted.

### 6.1 Weighted regression

The implementation uses weighted least-squares regression. For a selected window, each sample receives exponential recency weighting:

```text
weight = exp((epoch - now) / halfLife)
```

The standard half-life is three days. For terminal objects whose latest perigee is below 250 km, the half-life is reduced to one day so recent observations dominate as decay accelerates.

Separate weighted regressions are produced for:

- BSTAR over 7, 14, and 30 days
- perigee over 7, 14, and 30 days
- semi-major axis over 7 and 14 days
- apogee over 14 days
- N-dot over the available trend window

The persisted regression metadata includes slope, R², mean, standard deviation, and sample count where applicable.

## 7. Decay classification

`lib/explainReentryTrend.ts` is the central classification and explainability implementation. It evaluates three evidence families:

1. BSTAR trend
2. N-dot evidence
3. orbital-altitude trend

The resulting signal is one of:

- `decaying`
- `stable`
- `maneuvering`
- `insufficient_data`

### 7.1 BSTAR signal

BSTAR is extracted from TLE line 1 and interpreted as a fitted drag-related parameter. The trend signal requires a positive slope and combines slope magnitude with regression R²:

```text
bstarSignal = min(1, R² × min(1, slope / 1e-7))
```

BSTAR is deliberately not treated as a direct atmospheric density or drag measurement. In particular, maneuvering spacecraft can produce large or unstable fitted BSTAR values that do not correspond to sustained orbital decay.

### 7.2 N-dot signal

N-dot provides an independent indication of changing mean motion. The trend implementation combines a positive trend signal with an instantaneous decay indication. The instantaneous component can contribute a strength of 0.65 when the current N-dot exceeds the altitude-dependent decay threshold.

The thresholds used by `ndotIndicatesDecay()` are:

| Decay altitude | Required N-dot |
| --- | ---: |
| ≤ 400 km | > 1e-5 rev/day² |
| 400–500 km | > 2e-5 rev/day² |
| > 500 km | > 5e-5 rev/day² |

The altitude dependence reflects the increasing difficulty of distinguishing physical decay from TLE fit noise at higher altitudes.

### 7.3 Altitude signal

Altitude evidence is derived from the slopes of perigee and semi-major axis. A regression contributes only when the slope indicates meaningful downward motion. Signal strength is based on the magnitude of the negative slope and its R², with a minimum R² contribution floor of 0.35.

Altitude is weighted most heavily because a sustained reduction in orbital altitude is the most direct evidence of physical decay among the signals available to this system.

### 7.4 Confidence and maneuver detection

The aggregate confidence is:

```text
rawConfidence =
    0.35 × BSTAR signal
  + 0.25 × N-dot signal
  + 0.40 × altitude signal
```

Maneuver likelihood is estimated from BSTAR coefficient of variation when BSTAR is highly variable but there is insufficient corresponding altitude decay. A high maneuver likelihood reduces the decay confidence. When maneuver likelihood exceeds 0.5, the object is classified as `maneuvering` and its decay confidence is strongly suppressed.

A low-confidence object with enough epochs can be classified as `stable`. Otherwise, the system preserves `insufficient_data` rather than manufacturing a decay verdict.

## 8. Payload consensus policy

The system intentionally applies a stricter evidence policy to active payloads and unknown objects than to debris.

For objects where full consensus is required, BSTAR, N-dot, and altitude evidence must agree before the trend is considered a valid decay basis. This prevents a maneuvering spacecraft with anomalous BSTAR from being treated as a naturally decaying object.

The trend classifier also has lower-altitude exceptions because atmospheric drag becomes increasingly dominant as an object approaches re-entry:

- below 220 km, altitude evidence can be sufficient without full consensus;
- between 220 and 300 km, partial altitude consensus is accepted;
- at higher altitudes, payloads and unknown objects use the stricter full-consensus requirement.

The final request-time resolver additionally uses a 240 km payload threshold for its sub-threshold altitude path. These are separate gates: the 220/300 km values belong to trend consensus, while 240 km belongs to the final risk-resolution strategy.

## 9. Single-epoch risk model

The single-epoch path is implemented by `getReentryRisk()` in `lib/satelliteHelpers.ts`.

It is deliberately conservative and is primarily applicable to debris. Active payloads do not receive a normal single-epoch BSTAR re-entry verdict.

The calculation begins with BSTAR from the current TLE and estimates a decay rate using an exponential atmospheric-density proxy:

```text
decayRate =
    |BSTAR|
    × BASE_FACTOR
    × exp((400 - altitude) / 60)
    × (velocity / 7.905)
    × solarFluxMultiplier
```

where:

```text
BASE_FACTOR = 7.4e3
velocity = sqrt(MU / (EarthRadius + altitude))
```

The estimate assumes 120 km as the nominal completion altitude for the screening model. A 2/3 correction is applied to the linear time estimate to approximate the increase in drag as altitude decreases:

```text
estimatedDays = ceil(((perigee - 120) / decayRate) × 2/3)
```

This is a screening approximation, not a numerical atmospheric propagation model.

### 9.1 Sanity and anomaly gates

The single-epoch path returns `stable` rather than an estimate when any of the following conditions indicate that the result is not operationally credible:

- orbital period exceeds 600 minutes;
- perigee exceeds 2000 km;
- the object is not classified as debris;
- the calculated decay rate is below the minimum useful threshold;
- the calculated rate exceeds an altitude-dependent plausible-decay cap;
- the resulting time exceeds the long-horizon guard of 3650 days;
- the TLE indicates a raising orbit in the relevant negative-BSTAR/N-dot case.

These gates exist specifically because a mathematically valid BSTAR conversion can still produce an operationally nonsensical re-entry prediction.

## 10. Low-altitude fallback model

When an object is already below the final-resolution altitude threshold, DRAKON uses an altitude-driven estimate rather than relying exclusively on BSTAR.

The lower-atmosphere proxy is based on an exponential scale-height model:

```text
BASE_RATE_200KM = 10 × solarFluxMultiplier
SCALE_HEIGHT = 35 km

decayRate = BASE_RATE_200KM × exp((200 - altitude) / 35)
```

The resulting estimate is adjusted for highly eccentric geometry where the apogee is much higher than the perigee. A conservative multiplier is then applied before tier assignment.

This path exists because near-terminal objects are in a regime where altitude itself is a stronger operational signal than a potentially noisy single fitted drag coefficient.

## 11. Final risk resolution

`resolveReentryRisk()` in `lib/objectTrendRisk.ts` is the authoritative boundary between raw evidence and the `ReentryRisk` object consumed by the application.

The decision sequence is:

```text
Current TLE
   |
   +--> HEO geometry gate ------------------------> stable
   |
   +--> low-perigee path
   |      |
   |      +--> raising orbit / contradictory drag -> stable
   |      +--> maneuvering or sufficiently stable payload trend -> stable
   |      +--> altitude-based estimate
   |      +--> actionable trend available --------> choose more pessimistic estimate
   |
   +--> standard path
          |
          +--> actionable trend?
          |       |
          |       +--> payload/unknown + consensus not met -> stable
          |       +--> otherwise -----------------------> trend result
          |
          +--> debris without trend -------------------> single-epoch BSTAR model
          |
          +--> payload without trend ------------------> stable
```

An actionable trend currently means at least three epochs, at least one day of history, and a decay signal other than `insufficient_data`.

For standard-altitude debris, an actionable trend supersedes the single-epoch result. For payloads and unknown objects, the trend must first be classified as decaying and satisfy the applicable consensus policy.

For low-perigee objects, the altitude estimate and actionable trend can both be available. DRAKON selects the more pessimistic actionable estimate rather than applying a fixed source priority.

## 12. Risk tiers and confidence ceiling

Risk tiers are based on estimated days remaining and the altitude associated with the decay estimate. The critical boundary is fixed at 30 days. Warning and nominal boundaries compress as altitude increases.

| Decay altitude | Warning threshold | Nominal threshold |
| ---: | ---: | ---: |
| ≤ 300 km | 180 days | 365 days |
| 500 km | 120 days | 240 days |
| 800 km | 90 days | 180 days |
| 1000 km | 60 days | 120 days |
| 2000 km | 45 days | 90 days |

Values between these anchor altitudes are linearly interpolated by `getReentryTierThresholds()`.

The confidence ceiling prevents a low-confidence estimate from being presented as a high-severity operational signal. The current policy is:

- confidence < 0.75: critical and warning are downgraded to nominal;
- confidence 0.75–<0.85: critical is downgraded to warning;
- confidence ≥ 0.85: the computed tier is retained.

Objects below 220 km with no maneuver likelihood bypass this ceiling because the system treats terminal atmospheric decay as sufficiently dominant.

## 13. Solar flux integration

DRAKON incorporates daily NOAA F10.7 observations through `lib/solarFlux.ts`.

The current observation is stored in Redis under `solar:f107` with a 24-hour TTL. If Redis contains a valid value, the system derives the decay multiplier from that observation. If no valid observation is available, it falls back to the configured/default calibration value.

The multiplier is:

```text
CALIBRATION_MULTIPLIER = (200 / 150)^1.5

solarFluxMultiplier =
    CALIBRATION_MULTIPLIER
    × (F10.7 / 200)^0.3
```

The F10.7 exponent is intentionally sub-linear. The subsystem is using solar flux as a conservative screening correction rather than as a complete thermospheric-density model.

`/api/tle` exposes the active F10.7 value and multiplier through response headers when live Redis data is available. `/api/solar-flux` exposes the same state as JSON.

## 14. Space-Track TIP integration

TIP is an external reference channel and is not part of DRAKON's primary risk-resolution algorithm.

`lib/tip/spacetrackTip.ts` queries Space-Track for future TIP decay events, normalizes the timestamps, validates the NORAD ID, and keeps the newest message per object. An empty TIP response is treated as a valid result rather than as a provider failure because most catalog objects are not currently near decay.

The result is stored in Redis under `tip:predictions` with a four-hour TTL. Refreshes perform a full replacement rather than merging with the previous snapshot. This prevents an object that disappears from the current TIP response from retaining an obsolete decay window indefinitely.

DRAKON attaches the latest TIP record to its own `ReentryRisk` object and calculates:

- TIP days remaining;
- difference between DRAKON's estimate and TIP;
- `aligned` when the difference is within five days;
- `diverges` otherwise.

The DRAKON estimate itself is never replaced by TIP. If DRAKON has no estimate, TIP may still provide an effective display/sort value, but it remains distinguishable from `risk.estimatedDaysRemaining`.

TIP therefore acts as an external comparison and operational enrichment channel, not as hidden ground truth inside the model.

## 15. Background job processing

The trend worker is exposed through `POST /api/internal/process-trends?batchSize=200` and protected by `INTERNAL_JOB_SECRET`.

At the beginning of a worker invocation, rows still marked `processing` are deleted. The worker then claims pending jobs using `FOR UPDATE SKIP LOCKED`, which allows concurrent invocations to claim disjoint work without waiting on one another.

Claimed objects are processed in slices of ten using `Promise.allSettled()`. Successful jobs are deleted immediately so progress survives a later timeout. Failed jobs are returned to `pending` and their retry count is incremented. After three failures, the job is dropped and logged.

The endpoint has a 60-second execution limit and accepts a configurable batch size through the query string.

The repository does not currently contain the previously referenced GitHub Actions `tle-ping.yml` workflow. Scheduling is therefore external to this repository; the API routes themselves do not define a cron schedule. Deployments must provide the required scheduler calls to the internal endpoints.

## 16. Trend-version invalidation

`CURRENT_TREND_VERSION` is part of the derived-data contract. When the regression or classification algorithm changes, the version must be incremented.

`requeueStaleObjects()` finds rows in `object_trends` whose stored version is older than the current version and inserts pending trend jobs for them. The queue's uniqueness rule prevents duplicate pending jobs for the same object.

The current implementation requeues stale rows based on version alone. It does not require a new TLE epoch before scheduling the recomputation. This is important operational behavior because algorithm changes are intended to invalidate the derived cache independently of new source data.

## 17. Read-side API contract

The main trend endpoint is `GET /api/object-trends`.

It returns only rows whose `trendVersion` matches the current worker version and whose `decaySignal` is not `insufficient_data`. This prevents stale or explicitly incomplete trend rows from being treated as current analytics by the dashboard.

The response contains:

```text
trendVersion
trends[]
```

Each trend contains the persisted regression outputs, signal classification, confidence, consensus state, and re-entry estimate.

Object-specific APIs provide history, snapshots, and explanation data. The explanation layer reconstructs signal contributions from the persisted signal-strength columns instead of rerunning the regression. This keeps the detail view inexpensive and ensures that the displayed evidence corresponds to the same persisted trend result used elsewhere in the application.

## 18. Front-end integration

The main screening hook is `app/dashboard/reentry/hooks/useReentryScreening.ts`.

The page loads:

- current TLE entries;
- persisted object trends;
- TIP data;
- recent trend changes.

The hook then builds a single `riskById` map through `buildReentryRiskMap()`. This is important: the dashboard does not independently combine single-epoch and trend results. The same resolver used by the rest of the application produces the risk object.

Trend data is fetched lazily when the re-entry module is enabled and is cached by TanStack Query for 30 minutes. TIP is treated as optional enrichment and never gates the initial render.

The dashboard supports search, sorting, tier filtering, source filtering, and triage filtering. Rows are retained when they have either a DRAKON estimate or an attached TIP prediction.

## 19. Triage model

The dashboard groups objects into three operational buckets:

- **New / Escalated** — a recent snapshot exists within 72 hours and either represents the first recorded state or is more severe than the preceding snapshot.
- **Active** — currently critical or warning without a recent escalation.
- **Watching** — nominal or stable objects and non-escalating changes.

The severity order is:

```text
critical > warning > nominal > stable
```

An improvement does not become a new/escalated item merely because it changed recently.

## 20. Decision Trace and explainability

The object detail route `/dashboard/reentry/[noradId]` exposes the reasoning behind a screening result.

`buildReentryTrace()` and the `DecisionTrace` components present the result as a sequence rather than as a black-box label. The conceptual pipeline is:

```text
Load history
    ↓
BSTAR / N-dot / altitude analysis
    ↓
Consensus evaluation
    ↓
Re-entry estimate and tier
    ↓
Final risk resolution
    ↓
Optional external TIP comparison
```

The detail page also exposes evidence charts and a change-history timeline. The final verdict is derived from the same risk/trend pair used by the main screening UI, which avoids maintaining a second detail-page implementation of the risk algorithm.

The explainability layer persists the three signal strengths and their weights. Because the dashboard can reconstruct contribution values from those stored fields, it does not need to rerun historical regression merely to explain an already-computed result.

## 21. Performance characteristics

The subsystem separates CPU-bound and I/O-bound work deliberately.

The single-epoch calculation is synchronous and operates only on the current TLE fields. It can therefore be evaluated for the full catalog without database queries per object.

The final `reentryRisks` map in the visualization path is memoized from the TLE dataset, persisted trends, solar-flux multiplier, and TIP map. It does not depend on the five-second live SGP4 position updates used by the globe, preventing re-entry risk calculations from being recomputed every visualization tick.

Historical regressions are performed by the background worker. The dashboard consumes the resulting one-row-per-object cache instead of running regressions client-side.

This architecture keeps high-frequency visualization updates independent from relatively expensive historical analytics.

## 22. Operational failure behavior

The subsystem is intentionally fail-soft.

### TLE provider failure

A failed primary provider triggers the configured fallback. The cycle still merges the successful response and continues to ingest static debris groups.

### Concurrent ingestion

Redis key `tle:ingestion:lock` prevents overlapping ingestion cycles. The lock has a 120-second expiry so an abandoned execution does not block ingestion indefinitely.

### Empty current TLE cache

The TLE read API falls back to the stale snapshot. If both current and stale snapshots are absent, it returns HTTP 503 rather than returning an empty successful response.

### Solar-flux failure

If live F10.7 cannot be read from Redis, the screening formulas use the default calibration multiplier. Solar-flux availability therefore does not make the screening page unusable.

### TIP failure

TIP refresh failures leave the previous Redis snapshot untouched. If the cached TIP data later expires, the read path simply exposes no TIP enrichment. DRAKON's own risk calculation continues independently.

### Trend job failure

A failed trend job is retried up to three times. A single failed object does not fail the entire batch because object computations use `Promise.allSettled()`.

### Trend backlog interruption

Completed jobs are deleted incrementally after each concurrency slice. A worker timeout therefore loses at most the unfinished portion of the current batch rather than the entire claimed batch.

## 23. Data freshness and consistency rules

Several freshness rules are intentional parts of the model rather than incidental implementation details:

- TLE history is limited to a 30-day analytical window.
- Debris requires one day of history for an actionable trend; payloads require seven days.
- Terminal objects below 250 km receive priority requeue behavior.
- Trend rows must match `CURRENT_TREND_VERSION` before the read API returns them.
- Solar flux is cached for 24 hours.
- TIP is cached for four hours.
- TIP refresh replaces the full snapshot rather than merging stale predictions.
- Trend snapshots are written only when the classification or re-entry tier changes.

These rules intentionally distinguish source freshness, derived-cache freshness, and external-reference freshness.

## 24. Known limitations

The current implementation is not a full atmospheric re-entry prediction system. In particular, it does not model the complete state required for high-fidelity prediction.

Known limitations include:

- atmospheric density is represented by simplified exponential scale-height proxies rather than a full operational thermosphere model;
- geomagnetic storm effects are not explicitly modeled;
- spacecraft attitude, tumbling state, and changing drag area are not explicitly modeled;
- maneuver execution is inferred indirectly from TLE-derived signal behavior rather than from maneuver telemetry;
- BSTAR is a fitted TLE parameter and can be contaminated for maneuvering spacecraft;
- TLE updates are discrete and may be stale relative to the current physical state;
- full eccentricity-dependent atmospheric drag integration is not performed;
- the low-altitude fallback is intentionally empirical and conservative;
- re-entry estimates are screening estimates and should not be interpreted as precise impact-time predictions;
- the absence of a DRAKON estimate does not mean that an object cannot decay; it means the current evidence does not satisfy the screening policy.

The system should therefore be treated as an operational prioritization and decision-support layer, not as a substitute for authoritative re-entry predictions or conjunction-analysis systems.

## 25. Testing strategy

The repository contains unit and integration coverage around the critical decision boundaries, including:

- BSTAR parsing and single-epoch risk behavior;
- re-entry risk resolution;
- regression and trend computation;
- decay-signal classification;
- signal agreement and consensus;
- solar-flux conversion;
- TLE ingestion behavior;
- trend-job behavior;
- TIP parsing, freshness, and storage;
- re-entry chart and decision-trace construction;
- triage bucket classification.

The highest-value tests are those that lock down safety gates and source-selection behavior: maneuvering payloads must not become false positives from BSTAR alone, stale trend versions must not be treated as current, and low-quality provider responses must not trigger destructive catalog pruning.

## 26. Engineering invariants

The following invariants should be preserved when modifying the subsystem:

1. `resolveReentryRisk()` remains the single application-level authority for converting current TLE + trend data into `ReentryRisk`.
2. Payloads must not regain a single-epoch BSTAR-only re-entry path without an explicit redesign of the maneuvering-spacecraft safety policy.
3. Trend computation and explanation must continue to share the same signal definitions and named constants.
4. `CURRENT_TREND_VERSION` must be incremented whenever the meaning of persisted trend fields changes.
5. TIP must remain an external reference and must not silently overwrite DRAKON's own estimate.
6. Stale or degraded TLE provider responses must not be interpreted as authoritative object deletion.
7. Terminal objects must retain priority trend refresh behavior.
8. Request-time globe rendering must not acquire a per-object database dependency for re-entry risk.
9. `insufficient_data` must remain distinguishable from `stable`; lack of evidence is not evidence of stability.
10. Historical source provenance must remain intact when multiple providers are ingested in the same cycle.

## 27. Key implementation files

| Area | Implementation |
| --- | --- |
| Final risk resolution | `lib/objectTrendRisk.ts` |
| Single-epoch model | `lib/satelliteHelpers.ts` |
| Trend classification and explanation | `lib/explainReentryTrend.ts` |
| Signal agreement helpers | `lib/reentrySignals.ts` |
| Trend worker | `lib/jobs/computeObjectTrends.ts` |
| History ingestion | `lib/jobs/ingestTleHistory.ts` |
| Trend invalidation | `lib/jobs/requeueStaleObjects.ts` |
| TLE ingestion orchestration | `lib/ingestion/tleIngestionService.ts` |
| Database schema | `lib/db/schema.ts` |
| Solar flux | `lib/solarFlux.ts` |
| TIP provider | `lib/tip/spacetrackTip.ts` |
| TIP cache | `lib/tip/tipStore.ts` |
| TLE read API | `app/api/tle/route.ts` |
| Trend read API | `app/api/object-trends/route.ts` |
| TLE ingestion API | `app/api/internal/ingest-tle/route.ts` |
| Trend worker API | `app/api/internal/process-trends/route.ts` |
| Stale trend requeue API | `app/api/internal/requeue-stale/route.ts` |
| Solar flux API | `app/api/solar-flux/route.ts` |
| TIP API | `app/api/tip/route.ts` |
| Screening orchestration | `app/dashboard/reentry/hooks/useReentryScreening.ts` |
| Triage | `app/dashboard/reentry/lib/buildTriageBuckets.ts` |
| Decision Trace | `components/DecisionTrace/` and `app/dashboard/reentry/[noradId]/` |

## 28. Related documentation

- [TLE History Pipeline](./TLE_HISTORY_PIPELINE.md)
- [TLE Pipeline Architecture](./TLE_PIPELINE_ARCHITECTURE.md)
- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
