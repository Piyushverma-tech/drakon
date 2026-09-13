# Geomagnetic Storm Effects on Re-entry Risk

## 1. Purpose and implementation boundary

DRAKON's current re-entry screening model applies a slowly varying solar-activity correction through `lib/solarFlux.ts`, but it does not yet account for short-timescale thermospheric-density changes associated with geomagnetic activity.

This document defines the implementation and validation plan for adding that missing signal without turning DRAKON into a full operational thermosphere model.

The feature is an **external environmental correction layer**. It will ingest NOAA SWPC geomagnetic observations, normalize and retain a short recent history, derive a lag-aware geomagnetic activity feature, convert that feature into a bounded empirical atmospheric-density multiplier, and compose that multiplier with the existing F10.7 correction at final re-entry-risk resolution.

The first production implementation is intentionally not a physics-complete density model such as NRLMSISE-00, NRLMSIS 2.0, JB2008, DTM, or WAM. It is a calibrated screening correction intended to capture first-order storm-driven density changes on timescales that F10.7 alone cannot represent.

The implementation must be scientifically conservative: until retrospective validation demonstrates that the correction improves prediction quality without creating unacceptable false urgency, the geomagnetic multiplier remains disabled or forced to `1.0`.

## 2. Verified external-data decision

The earlier proposal to consume a NOAA first-class JSON `ap` feed is not valid for the current SWPC product surface.

The current NOAA JSON catalog exposes `planetary_k_index_1m.json` as the real-time minute-cadence planetary Kp stream. NOAA's current JSON product catalog does not expose an analogous clean real-time planetary-ap JSON feed. NOAA's legacy `AK.txt` product contains a textual "Planetary(estimated Ap)" row, but it is a fixed-width station-oriented product and is not a clean counterpart to `f107_cm_flux.json`.

Therefore the implementation will use the NOAA real-time planetary Kp feed as the primary live source and perform the standard published Kp-to-ap conversion inside DRAKON.

This conversion is not an empirical model. It is the established Bartels/IAGA lookup that maps the 28 discrete Kp classes to their corresponding three-hour `ap` equivalent amplitudes. NOAA NCEI publishes the lookup explicitly, and NASA documentation reproduces the same table.

This is preferable to parsing the legacy `AK.txt` product because it keeps NOAA-specific transport parsing isolated while making the index conversion deterministic, tiny, testable, and versionable.

### Authoritative source roles

| Source                           | Role                                     | First implementation         |
| -------------------------------- | ---------------------------------------- | ---------------------------- |
| NOAA `planetary_k_index_1m.json` | Near-real-time planetary Kp observations | **Required**                 |
| Internal Bartels Kp→ap lookup    | Convert each Kp class to three-hour ap   | **Required**                 |
| NOAA `AK.txt` estimated Ap row   | Legacy text alternative                  | **Not used**                 |
| CelesTrak space-weather data     | Independent reference/validation source  | **Not a runtime dependency** |
| GFZ Kp/ap nowcast series         | Independent validation/reference         | **Not a runtime dependency** |

CelesTrak's current space-weather documentation independently confirms the standard relationship: Kp data is used to calculate ap, while its current nowcast data contains both three-hourly Kp and ap. That makes CelesTrak useful for cross-validation of DRAKON's conversion rather than necessary for the runtime path.

## 3. Current DRAKON model boundary

The current re-entry implementation has three relevant atmospheric paths.

### 3.1 Single-epoch screening

`getReentryRisk()` in `lib/satelliteHelpers.ts` estimates decay for qualifying debris from current TLE-derived evidence. The atmospheric proxy contains the altitude-sensitive factor:

```text
decayRate ∝ |BSTAR|
           × exp((400 - altitude) / 60)
           × velocityFactor
           × solarFluxMultiplier
```

This path is intentionally inexpensive and does not require a database query per object.

### 3.2 Historical trend model

`computeObjectTrends.ts` and `explainReentryTrend.ts` evaluate repeated TLE observations over 7/14/30-day windows using BSTAR, N-dot, and orbital-altitude signals.

Geomagnetic forcing must **not** be introduced into these persisted regressions in the first implementation. The historical trend cache represents orbital evidence derived from TLE history. Injecting an external environmental series into that layer would couple `object_trends` to a changing provider, require environmental-history alignment, and force trend-version changes whenever the atmospheric model changes.

### 3.3 Low-altitude fallback

`resolveReentryRisk()` in `lib/objectTrendRisk.ts` can use an altitude-dominated fallback for very low-perigee objects. Its decay proxy contains:

```text
decayRate ∝ exp((200 - altitude) / 35)
             × solarFluxMultiplier
```

This path is deliberately sensitive to near-terminal atmospheric conditions and is therefore a primary consumer of the new geomagnetic correction.

### 3.4 Final integration boundary

`resolveReentryRisk()` is the correct integration boundary because it already combines current TLE evidence, persisted trend evidence, payload/debris policy, low-altitude handling, and the existing solar correction.

The new signal must modify only the atmospheric correction state at this boundary. It must not alter the existing decision tree, payload consensus policy, trend persistence semantics, or risk-tier thresholds in the first release.

## 4. Scientific basis

Geomagnetic activity is a meaningful short-timescale driver of thermospheric density variability. Planetary Kp is a three-hour magnetic-activity index, and the associated ap index converts the quasi-logarithmic Kp scale to an equivalent-amplitude scale. NOAA NCEI defines ap as a three-hour planetary equivalent-amplitude index and publishes the standard Kp/ap conversion table.

The important modeling constraint is that a geomagnetic index is an **external proxy for thermospheric forcing**, not a direct local density measurement. The actual density response depends on altitude, latitude, local solar time, season, storm phase, and thermospheric state/history. A global planetary index can therefore identify enhanced forcing without uniquely determining local density at every satellite.

DRAKON should consequently use geomagnetic activity as a bounded empirical correction to its existing atmospheric proxy, not interpret the multiplier as a measured density ratio.

### Why ap is an intermediate representation

Kp itself is quasi-logarithmic; direct averaging of Kp values is not appropriate as a linear activity measure. The standard solution is to convert each three-hour Kp class to its corresponding `ap` value and then perform any temporal aggregation on the linearized ap series. NOAA publishes this relationship explicitly.

The first production path is therefore:

```text
NOAA real-time Kp
      ↓
standard Kp → ap lookup
      ↓
three-hour ap observations
      ↓
lagged / recency-weighted activity feature
      ↓
empirical geomagnetic multiplier
```

## 5. Kp-to-ap conversion specification

The conversion must be implemented as a pure lookup function. It is not to be fitted, interpolated, or learned.

### 5.1 Published lookup table

Use the standard 28-entry Bartels/IAGA mapping:

| Kp class |  ap | Kp class |  ap |
| -------- | --: | -------- | --: |
| 0o       |   0 | 5-       |  39 |
| 0+       |   2 | 5o       |  48 |
| 1-       |   3 | 5+       |  56 |
| 1o       |   4 | 6-       |  67 |
| 1+       |   5 | 6o       |  80 |
| 2-       |   6 | 6+       |  94 |
| 2o       |   7 | 7-       | 111 |
| 2+       |   9 | 7o       | 132 |
| 3-       |  12 | 7+       | 154 |
| 3o       |  15 | 8-       | 179 |
| 3+       |  18 | 8o       | 207 |
| 4-       |  22 | 8+       | 236 |
| 4o       |  27 | 9-       | 300 |
| 4+       |  32 | 9o       | 400 |

This table is the published conversion used by NOAA/NCEI and NASA documentation.

The implementation should store the table as a readonly constant in `lib/geomagneticIndex.ts` and expose a pure function such as:

```typescript
function kpToAp(kp: number | string): number;
```

### 5.2 Kp representation normalization

The NOAA real-time JSON feed may represent Kp as a numeric value using the one-third-step convention or an equivalent encoded representation. The parser must normalize the provider value into the canonical 28 classes before lookup.

The implementation must not silently round arbitrary Kp to the nearest integer. Kp subdivisions such as `4-`, `4o`, and `4+` carry materially different ap values.

The accepted canonical sequence is:

```text
0o, 0+, 1-, 1o, 1+, ... , 8+, 9-, 9o
```

If the provider payload cannot be unambiguously normalized to one of these published classes, the sample must be rejected rather than approximated.

### 5.3 No model version for the table

The lookup itself is a standards/reference conversion, not a DRAKON calibration parameter. It should still have a source comment and unit tests, but changing the Kp→ap table would require a deliberate scientific-review decision rather than ordinary model tuning.

## 6. NOAA ingestion

### 6.1 Primary endpoint

Use:

```text
https://services.swpc.noaa.gov/json/planetary_k_index_1m.json
```

The NOAA JSON catalog currently lists this as the real-time planetary K-index product.

The exact response schema must be verified from the live endpoint during implementation. Do not infer field names from this document alone.

### 6.2 Sample selection

The feed is minute-cadence, but the geomagnetic model should not treat every minute as an independent physical measurement of the thermosphere.

For each refresh:

1. Parse the latest valid planetary Kp observation(s).
2. Normalize each Kp sample to the canonical class.
3. Convert the class to ap.
4. Preserve its source timestamp.
5. Deduplicate observations by timestamp.
6. Retain enough observations to reconstruct the latest completed three-hour interval and a rolling short history.

The model should prefer the most recent valid sample for storm awareness, but its final activity feature must be derived from the three-hour ap sequence rather than raw minute-by-minute Kp noise.

### 6.3 Three-hour aggregation semantics

The canonical model unit is a three-hour ap observation.

If the NOAA minute stream contains repeated estimated Kp values for the same three-hour interval, DRAKON should not create dozens of independent ap observations from the same interval. Normalize the source stream to one effective ap observation per three-hour interval.

The chosen interval representative should be documented in implementation and tests. Prefer the value associated with the latest valid estimated planetary Kp for that interval, rather than averaging Kp numerically.

### 6.4 Cross-check during development

During implementation, compare DRAKON's generated three-hour ap values against an independent authoritative/reference series such as GFZ's Kp/ap nowcast or CelesTrak's space-weather dataset.

This is a validation step, not a runtime dependency. CelesTrak's current documentation explicitly includes three-hourly Kp and ap fields and identifies primary-source geomagnetic data.

## 7. `lib/geomagneticIndex.ts`

Create `lib/geomagneticIndex.ts` as the sole module responsible for the geomagnetic environmental signal.

It should own:

- NOAA endpoint configuration;
- provider response validation;
- Kp normalization;
- the published Kp→ap lookup;
- three-hour interval normalization;
- short-term history retention;
- stale/live/default state determination;
- lagged activity-feature calculation;
- the empirical multiplier;
- Redis serialization/deserialization;
- safe fallback behavior.

It must not own:

- `ReentryRisk` resolution;
- payload/debris policy;
- risk-tier assignment;
- trend classification;
- Decision Trace rendering.

Those responsibilities remain in the existing re-entry architecture.

### Suggested state contract

```typescript
type GeomagneticState = {
  kp: number;
  kpClass: string;
  ap: number;
  observedAt: string;
  ageMinutes: number;
  history: Array<{
    kp: number;
    kpClass: string;
    ap: number;
    observedAt: string;
  }>;
  activity: number;
  multiplier: number;
  source: 'noaa-swpc';
  freshness: 'live' | 'stale' | 'default';
};
```

The exact public type may be smaller, but the internal state must retain enough information to reproduce and explain the multiplier.

## 8. Redis storage and freshness

Geomagnetic activity changes much faster than F10.7, so the Redis design must retain short-term history instead of using only one scalar.

Recommended keys:

```text
geomagnetic:latest
geomagnetic:history
```

`geomagnetic:latest` stores the latest normalized sample and derived freshness metadata.

`geomagnetic:history` stores a bounded rolling sequence of effective three-hour ap samples. A 24-hour analytical window gives eight three-hour periods; the implementation may retain a modestly larger buffer if needed for calibration while keeping the payload negligible.

### Freshness states

The subsystem must distinguish:

```text
live      = newest usable sample is inside freshness threshold
stale     = no fresh sample, but a bounded recent history remains usable
default   = no usable geomagnetic history exists
```

A live sample should use a short TTL on the order of 1–3 hours. The exact TTL must be chosen relative to NOAA's publication cadence and tested against expected product delays.

The historical buffer needs a separate protective lifetime long enough to survive a temporary NOAA or Redis failure without immediately erasing the last usable storm state.

The no-data multiplier is exactly `1.0`.

A stale state may continue to use the last validated history-derived multiplier, but its stale age must be exposed to observability and Decision Trace. A stale signal must never be presented as current NOAA data.

## 9. Activity feature construction

Do not map the newest ap sample directly to the multiplier.

The first model should derive a short-term geomagnetic activity feature from the recent three-hour ap sequence. The objective is to represent both storm amplitude and persistence while avoiding minute-level noise.

### 9.1 Recency-weighted activity

A suitable starting formulation is:

```text
activity = Σ(ap_i × w_i) / Σ(w_i)

w_i = exp(-age_i / τ)
```

where `age_i` is the age of the three-hour observation and `τ` is a calibration parameter.

Do not choose `τ` merely because it produces a convenient-looking curve. It must be evaluated against historical storm response.

### 9.2 Persistence term

A persistent storm and a single isolated elevated interval should not necessarily receive the same correction.

The model should therefore retain a simple persistence descriptor, for example:

```text
persistence = fraction of recent intervals above the quiet threshold
```

The first implementation may use persistence only as a diagnostic feature rather than introducing another fitted coefficient into the multiplier.

### 9.3 Storm phase

For calibration and diagnostics, classify recent conditions into:

```text
quiet
rising
sustained
recovering
```

based on the recent activity history and its short-term slope.

The production multiplier should initially depend on the smoothed activity level and not strongly on the derivative. This prevents noisy storm-onset estimates from producing artificial lifetime discontinuities.

## 10. Empirical multiplier model

The geomagnetic multiplier represents an atmospheric-density correction proxy. It is not a measured density ratio.

The first implementation should use a continuous, monotonic, bounded function with explicitly versioned calibration parameters.

A suitable family is:

```text
multiplier = 1                                      activity <= threshold
multiplier = 1 + A × f(activity - threshold)       activity > threshold
multiplier = min(multiplier, MAX_MULTIPLIER)
```

where `f(x)` is continuous and monotonic.

A sub-linear power-law family is an acceptable initial candidate:

```text
multiplier = 1 + A × (x / scale)^p
```

with `0 < p < 1`.

A smooth exponential family may also be evaluated during the calibration sweep. The final family must be selected from retrospective evidence, not convenience.

### 10.1 Calibration parameters

At minimum, keep these as named constants/configuration values:

```text
GEOMAG_MODEL_VERSION
GEOMAG_ACTIVITY_THRESHOLD
GEOMAG_SCALE
GEOMAG_POWER
MAX_GEOMAG_MULTIPLIER
GEOMAG_HISTORY_HOURS
GEOMAG_DECAY_CONSTANT_HOURS
```

Do not scatter these values through the model or API routes.

### 10.2 No hard Kp/ap storm steps

Do not implement logic such as:

```text
ap < X  → 1.0
ap >= X → 1.2
```

as the final production model.

The published Kp→ap lookup is discrete because it is an index conversion. The atmospheric multiplier must remain continuous because it is a DRAKON calibration model.

## 11. Bounding and physical safety

The multiplier must satisfy:

```text
1.0 <= geomagneticMultiplier <= MAX_GEOMAG_MULTIPLIER
```

The upper bound must be explicitly calibrated.

This safety measure is mandatory because the existing decay-rate proxies already contain strong altitude exponentials:

```text
exp((400 - altitude) / 60)
exp((200 - altitude) / 35)
```

A large multiplicative correction can therefore produce disproportionately large lifetime reductions for terminal objects.

The first operational release should bias toward under-correction rather than risk a large unvalidated storm multiplier.

The implementation must also verify numerical sanity after composition:

```text
combinedMultiplier = solarFluxMultiplier × geomagneticMultiplier
```

Non-finite or out-of-range results must fall back to a safe bounded value rather than propagating invalid arithmetic into re-entry estimates.

## 12. Composition with solar activity

The existing F10.7 correction remains unchanged.

The environmental state is composed once:

```typescript
const combinedMultiplier = solarFluxMultiplier * geomagneticMultiplier;
```

The combined factor is supplied at the existing atmospheric-correction boundary.

Conceptually:

```text
F10.7 ----------------------> solarFluxMultiplier ----┐
                                                       ├─> combinedMultiplier
NOAA Kp → ap → activity → geomagneticMultiplier -----┘
                                                       |
                                                       v
                                              atmospheric proxy
```

This composition must be centralized. Do not multiply the geomagnetic factor independently inside several branches, because that would make later model calibration difficult and could cause inconsistent risk results between the single-epoch and low-altitude paths.

## 13. Application integration

### 13.1 `lib/satelliteHelpers.ts`

Keep `getReentryRisk()` focused on orbital inputs and the already-resolved atmospheric multiplier. Prefer passing the combined environmental factor rather than adding a second geomagnetic-specific parameter where the current signature allows this cleanly.

### 13.2 `lib/objectTrendRisk.ts`

Resolve environmental state once and pass the combined multiplier consistently through the single-epoch and low-altitude paths.

`resolveReentryRisk()` remains the application-level authority for final risk resolution.

### 13.3 Dashboard and globe orchestration

`app/dashboard/reentry/hooks/useReentryScreening.ts` and globe-side risk construction must consume the resolved risk result rather than independently fetching or interpreting geomagnetic data.

No UI component should know how Kp becomes ap or how the activity feature becomes a multiplier.

### 13.4 Trend persistence

Do not add geomagnetic columns to `object_trends` in this phase.

Do not modify historical regression inputs.

Do not bump `CURRENT_TREND_VERSION` solely because the final atmospheric correction changes.

A trend-version change is required only if persisted regression semantics change.

## 14. Public API and observability

### `/api/geomagnetic-index`

Add a read endpoint analogous to `/api/solar-flux`.

Expose at minimum:

```text
kp
kpClass
ap
observedAt
ageMinutes
activity
multiplier
freshness
source
modelVersion
```

Do not expose NOAA credentials or internal Redis details.

### `/api/tle` response headers

Expose the environmental state used by the serving application through compact headers analogous to the existing solar headers:

```text
x-geomagnetic-kp
x-geomagnetic-ap
x-geomagnetic-multiplier
```

If the state is stale/default, expose sufficient metadata for a client or diagnostic tool to distinguish that condition rather than implying that live NOAA data was used.

### Decision Trace

The explainability surface should be able to show the environmental contribution:

```text
Atmospheric environment
  F10.7: <value>
  Solar multiplier: <value>
  Kp: <value> (<canonical class>)
  ap: <value>
  Recent activity: <value>
  Geomagnetic multiplier: <value>
  Combined atmospheric multiplier: <value>
  Freshness: live / stale / default
```

The text should explicitly identify the multiplier as an **empirical screening correction**, not as measured local thermospheric density.

## 15. Refresh scheduling

Geomagnetic refresh should be independent of TLE ingestion.

Recommended starting schedule:

```text
geomagnetic refresh: hourly
TLE ingestion:       existing schedule
trend worker:        existing 15-minute schedule
solar flux:          existing daily schedule
```

Hourly execution is a scheduling choice, not a claim that the environmental signal only changes hourly. The minute-cadence NOAA source can publish more frequently; the short TTL and rolling history are what preserve the storm signal between scheduled refreshes.

The refresh endpoint must be idempotent and must not block TLE ingestion.

A refresh failure leaves the last validated history intact.

## 16. Fail-soft behavior

Failure semantics are part of the model contract:

| Condition                                          | Required behavior                                  |
| -------------------------------------------------- | -------------------------------------------------- |
| Valid recent NOAA Kp                               | Normalize → ap → activity → multiplier             |
| NOAA request failure + valid history               | Keep last validated history; mark stale            |
| NOAA request failure + no history                  | Multiplier = `1.0`; mark default                   |
| Malformed payload                                  | Reject sample; preserve last valid state           |
| Unrecognized Kp class                              | Reject sample; do not approximate                  |
| Non-finite/negative ap                             | Reject sample                                      |
| Invalid activity calculation                       | Multiplier = `1.0` or last validated bounded state |
| Multiplier outside bounds                          | Clamp to configured bounds                         |
| Redis latest unavailable + local history available | Use local validated state                          |
| Redis unavailable + no validated state             | Multiplier = `1.0`                                 |

No environmental failure may throw from the risk-resolution path merely because NOAA or Redis is unavailable.

## 17. Calibration methodology

Calibration is the highest-risk part of the feature. The atmospheric multiplier must not be selected from intuition, a single storm, or agreement with one external prediction stream.

### Phase 1 — build a historical dataset

Build synchronized storm/control windows containing:

- DRAKON TLE history;
- NOAA planetary Kp observations;
- internally converted three-hour ap values;
- NOAA F10.7;
- Space-Track TIP predictions where available;
- successive TLE-derived perigee, semi-major-axis, N-dot, and BSTAR behavior.

The dataset must include both geomagnetically active and quiet control periods.

### Phase 2 — verify index conversion

Before calibrating the multiplier, verify that DRAKON's 28-entry Kp→ap lookup reproduces an independent reference series for the same Kp inputs.

This isolates index-conversion correctness from atmospheric-model calibration.

### Phase 3 — evaluate activity filters

Compare candidate history windows, recency constants, and persistence formulations.

At this stage the output should be a diagnostic activity feature only. Do not modify risk estimates.

### Phase 4 — parameter sweep

Evaluate multiple multiplier families and parameter ranges.

Measure at minimum:

- error in estimated days remaining;
- storm-onset lag;
- storm-recovery lag;
- lifetime bias by altitude band;
- improvement versus solar-only baseline;
- quiet-period false acceleration;
- number and direction of risk-tier changes.

Select the simplest model that produces a repeatable improvement.

### Phase 5 — TIP comparison

Use the existing `aligned` / `diverges` machinery as an external comparison.

TIP is a reference signal, not the optimization target. The purpose of this analysis is to determine whether geomagnetic forcing explains a repeatable component of DRAKON/TIP divergence.

### Phase 6 — orbital-response validation

Use observed TLE evolution as the primary physical validation signal. Compare modeled atmospheric acceleration with measured changes in perigee, semi-major axis, mean-motion derivative, and BSTAR behavior.

Perform this by altitude bands because geomagnetic forcing does not translate to an identical drag response at all altitudes.

### Phase 7 — quiet-window rejection test

A candidate correction that improves storm cases but creates significant artificial acceleration during quiet windows must be rejected.

The required qualitative outcome is:

```text
storm activity ↑  → modeled drag does not decrease
quiet activity   → model remains close to solar-only baseline
```

## 18. Storm-phase analysis

Calibration must distinguish at least:

```text
onset       activity rising
main phase  sustained elevation
recovery    activity falling after sustained elevation
quiet       baseline/control
```

This is necessary because the same current ap can occur at materially different positions in the storm lifecycle.

The first multiplier should be based primarily on lagged activity level. A storm-derivative term may be retained for diagnostics but should not be allowed to dominate the production multiplier until historical validation demonstrates a stable benefit.

## 19. Validation metrics and acceptance criteria

The feature is not production-ready when unit tests pass alone.

Before enabling the multiplier for live risk scoring, establish quantitative acceptance criteria covering:

1. **Index correctness:** Kp→ap conversion matches the published reference table for all 28 classes.
2. **Freshness correctness:** live, stale, and default states behave deterministically under controlled failures.
3. **Monotonicity:** increasing recent geomagnetic activity cannot lower the modeled decay rate with all orbital inputs fixed.
4. **Boundedness:** the multiplier never exceeds its configured safety cap.
5. **Numerical stability:** composition with F10.7 never creates NaN/Infinity or uncontrolled lifetime collapse.
6. **Storm improvement:** historical storm windows show statistically defensible improvement over the solar-only baseline.
7. **Quiet neutrality:** quiet/control windows do not show an unacceptable increase in false acceleration.
8. **Altitude consistency:** the correction's behavior remains bounded and interpretable across relevant altitude bands.
9. **TIP comparison:** divergence does not systematically worsen after calibration.
10. **Risk safety:** the correction does not create unacceptable false critical/warning escalations.

Exact numeric acceptance thresholds should be defined from a baseline evaluation dataset before calibration, rather than invented after seeing the results.

## 20. Testing strategy

### 20.1 Unit tests

Add `lib/geomagneticIndex.test.ts` covering:

- canonical Kp-class parsing;
- all 28 Kp→ap lookup values;
- rejection of unrecognized Kp values;
- sample timestamp normalization;
- three-hour interval deduplication;
- rolling history insertion and bounded retention;
- stale-state detection;
- default multiplier exactly `1.0` with no usable state;
- Redis/provider failure fallback;
- monotonic multiplier behavior;
- multiplier bounds;
- deterministic calibration fixtures.

### 20.2 Integration tests

Add tests for:

- `/api/geomagnetic-index` response shape;
- `/api/tle` geomagnetic headers;
- live/stale/default metadata;
- combined solar × geomagnetic multiplier propagation;
- no mutation of `object_trends` schema or trend version;
- graceful risk resolution when the geomagnetic subsystem is unavailable.

### 20.3 Historical regression tests

Create replay fixtures for at least:

- quiet activity;
- moderate activity;
- strong storm;
- onset;
- main phase;
- recovery.

The regression harness should compare:

```text
solar-only model
vs.
solar + geomagnetic model
```

and report both improvement and regressions by object/altitude/storm phase.

## 21. Rollout strategy

### Stage 1 — index-validation mode

Implement the NOAA parser and Kp→ap conversion without applying any multiplier.

Compare the generated ap series against independent references.

### Stage 2 — shadow mode

Calculate the environmental activity and proposed multiplier, but continue using the solar-only risk result for production.

Record:

- Kp/Kp class;
- ap;
- activity feature;
- proposed multiplier;
- freshness state;
- solar-only estimate;
- corrected estimate;
- tier delta;
- TIP comparison.

### Stage 3 — historical calibration

Run the full storm/control calibration process and select the model version and parameter set.

### Stage 4 — limited production integration

Enable the correction for the single-epoch debris and low-altitude atmospheric paths while preserving the existing confidence ceiling.

### Stage 5 — critical-tier evaluation

Observe whether storm-driven corrections improve operational triage without producing unacceptable false urgency.

Any later change to the safety ceiling must be a separate decision, supported by validation evidence.

## 22. Confidence and risk-tier interaction

The first release must not allow geomagnetic activity to bypass the existing confidence ceiling.

The correction may change the raw estimated lifetime because the environment has changed, but environmental activity alone is not sufficient evidence to claim that the orbital estimate itself is high-confidence.

In particular:

- no direct critical-tier bypass;
- no automatic confidence boost from storm activity;
- no special low-altitude exception until validated separately.

If future evidence supports a special rule for highly disturbed terminal objects, it should be introduced as a named policy with its own tests and documentation.

## 23. Non-goals

The first implementation must not attempt to provide:

- direct local thermospheric-density reconstruction;
- latitude/local-time density maps;
- auroral-region density morphology;
- covariance-aware atmospheric propagation;
- a replacement for SGP4/TLE propagation;
- authoritative re-entry predictions;
- a full Jacchia, DTM, NRLMSIS, JB2008, or WAM implementation;
- geomagnetic inputs inside the persisted TLE trend regression;
- direct optimization against TIP as though TIP were ground truth.

## 24. Future upgrade path

The environmental layer should remain extensible:

```text
F10.7
+ geomagnetic history
+ solar-wind / IMF features
+ altitude
+ latitude
+ local solar time
+ calibrated thermosphere model
        ↓
local neutral-density estimate
```

At that point `getReentryRisk()` can consume a density estimate rather than applying a scalar empirical correction.

The first implementation must therefore keep NOAA-specific parsing and geomagnetic semantics entirely inside `lib/geomagneticIndex.ts` and avoid spreading Kp/ap assumptions through `satelliteHelpers.ts`, `objectTrendRisk.ts`, or dashboard code.

## 25. Engineering invariants

1. The runtime primary external input is NOAA SWPC's real-time planetary Kp stream.
2. DRAKON converts Kp to three-hour ap using the published fixed 28-entry Bartels/IAGA lookup; this conversion is deterministic and separately tested.
3. The Kp→ap table is a standards conversion, not a fitted DRAKON calibration curve.
4. The final atmospheric multiplier is calibrated separately from the Kp→ap conversion.
5. Geomagnetic data is external environmental state, not historical orbital evidence.
6. Missing geomagnetic data never blocks ingestion, trend computation, or risk resolution.
7. The no-data multiplier is exactly `1.0`.
8. The production geomagnetic multiplier is continuous, monotonic, finite, and explicitly bounded.
9. The activity feature is based on normalized three-hour ap observations, not a naive numeric average of Kp.
10. Recent history is retained independently from the latest sample so storm persistence can be represented.
11. NOAA-specific parsing, normalization, and conversion remain isolated in `lib/geomagneticIndex.ts`.
12. The environmental correction is composed with the existing solar correction at one application-level boundary.
13. Geomagnetic activity does not directly modify persisted `object_trends` in the first implementation.
14. `CURRENT_TREND_VERSION` is not changed unless persisted trend semantics change.
15. Geomagnetic activity cannot bypass the existing confidence ceiling in the first release.
16. Decision Trace can identify the environmental inputs and multiplier used for a risk result.
17. Calibration parameters are named, versioned, and reproducible.
18. Calibration uses both storm and quiet/control windows.
19. TIP is a validation/reference source, not the target function for blind fitting.
20. The first production implementation must remain describable as an empirical screening correction, not a physical thermosphere model.

## 26. Verification checklist against the current repository

Before implementation, verify these boundaries against `main`:

```text
lib/solarFlux.ts
    ↓ established external-environment pattern
lib/geomagneticIndex.ts
    ↓ NOAA ingestion + Kp normalization + Kp→ap + activity + multiplier
lib/satelliteHelpers.ts
    ↓ single-epoch atmospheric proxy
lib/objectTrendRisk.ts
    ↓ final risk resolution + low-altitude path
app/dashboard/reentry/hooks/useReentryScreening.ts
    ↓ dashboard risk map
Globe/re-entry risk callers
    ↓ application-wide resolved risk
```

No changes are intended for:

- `tle_history` schema;
- `object_trends` schema;
- `trend_jobs`;
- `trend_snapshots`;
- TLE partition management;
- historical 7/14/30-day trend windows;
- payload consensus rules;
- TIP storage semantics.

Implementation is complete only when the signal can be traced end-to-end:

```text
NOAA Kp
  ↓
canonical Kp class
  ↓
published Kp→ap lookup
  ↓
three-hour ap history
  ↓
lagged activity feature
  ↓
bounded geomagnetic multiplier
  ↓
solar × geomagnetic composition
  ↓
getReentryRisk / low-altitude fallback
  ↓
resolveReentryRisk
  ↓
ReentryRisk
  ↓
API / Decision Trace / dashboard
```

## 27. References

1. NOAA NCEI, **Magnetic Activity Indices** — Kp/ap definitions and the published 28-entry Kp→ap conversion table.  
   https://www.ngdc.noaa.gov/stp/solar/magindices.html  
   https://www.ngdc.noaa.gov/geomag/indices/kp_ap.html

2. NOAA SWPC, **JSON product catalog** — current product inventory including `planetary_k_index_1m.json` and `f107_cm_flux.json`.  
   https://services.swpc.noaa.gov/json/

3. NOAA SWPC, **The K-index** — operational definition of K/Kp, three-hour indexing, and near-real-time estimated planetary Kp behavior.  
   https://www.swpc.noaa.gov/sites/default/files/images/u2/TheK-index.pdf

4. CelesTrak, **Space Weather Data Documentation** — current primary-source data architecture and explicit Kp/ap fields; documents that Kp is used to calculate ap in its processing chain.  
   https://www.celestrak.org/SpaceData/SpaceWx-format.php

5. NASA NTRS, **ap, Ap, Cp, and C9 Indices** — historical reference for the Bartels Kp→ap conversion and three-hour ap definition.  
   https://ntrs.nasa.gov/citations/19910021306

6. NASA NTRS, **Kp to ap conversion documentation** — historical implementation example of the published conversion table.  
   https://ntrs.nasa.gov/citations/19700022692

7. GFZ Potsdam, **Kp Index Data Directory** — independent reference source exposing Kp/ap nowcast products for validation.  
   https://www-app3.gfz-potsdam.de/data.php
