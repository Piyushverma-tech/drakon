# Geomagnetic Storm Effects on Re-entry Risk

## 1. Purpose

DRAKON's current re-entry screening model already applies a solar-activity correction through `lib/solarFlux.ts`, but it does not currently account for short-timescale thermospheric density changes caused by geomagnetic activity.

This plan defines a scientifically conservative extension for incorporating geomagnetic storm effects into the existing re-entry model without turning DRAKON into a full operational thermosphere model.

The design treats geomagnetic activity as an **external atmospheric calibration signal**: it is fetched from NOAA SWPC, cached with explicit freshness semantics, converted into a bounded empirical density multiplier, and composed with the existing solar-flux multiplier at final risk resolution.

The goal is not to reproduce a Jacchia, DTM, NRLMSISE-00, NRLMSIS 2.0, or other full thermospheric density model. The goal is to capture a missing first-order environmental effect on short timescales while preserving DRAKON's existing fail-soft and explainable screening architecture.

## 2. Current model boundary

The current re-entry architecture has three relevant paths.

### 2.1 Single-epoch screening

`getReentryRisk()` in `lib/satelliteHelpers.ts` estimates decay for qualifying debris using current TLE-derived BSTAR and N-dot evidence. Its atmospheric proxy contains the altitude-sensitive term:

```text
decayRate ∝ |BSTAR|
           × exp((400 - altitude) / 60)
           × velocityFactor
           × solarFluxMultiplier
```

This path is intentionally inexpensive and does not require a database query per object.

### 2.2 Historical trend screening

`computeObjectTrends.ts` and `explainReentryTrend.ts` use repeated TLE observations to evaluate BSTAR, N-dot, and orbital-altitude trends over 7/14/30-day windows. This persisted regression model does not currently contain an explicit atmospheric-density state variable.

Geomagnetic correction should **not** be injected into these persisted regressions in this phase. Doing so would make the historical trend cache dependent on a changing external environmental series and would require reprocessing historical observations whenever the geomagnetic model changes.

### 2.3 Low-altitude fallback

For very low-perigee objects, `resolveReentryRisk()` can use the altitude-dominated fallback path. Its decay proxy contains:

```text
decayRate ∝ exp((200 - altitude) / 35)
             × solarFluxMultiplier
```

This path is particularly sensitive to short-timescale density changes and is therefore one of the primary consumers of the new geomagnetic correction.

### 2.4 Final risk resolution boundary

`resolveReentryRisk()` in `lib/objectTrendRisk.ts` is the correct integration boundary because it already combines the single-epoch estimate, historical trend evidence, payload/debris policy, low-altitude handling, and the existing solar correction.

The geomagnetic signal should modify the atmospheric estimate at this boundary without changing the existing decision tree, consensus rules, trend persistence model, or risk-tier policy.

## 3. Scientific rationale

Geomagnetic activity can produce rapid changes in thermospheric density that are not represented by slowly varying solar-radio-flux measurements alone. NOAA's operational geomagnetic products describe Kp as a global indicator of magnetic disturbance and note that Kp is defined over three-hour intervals; the real-time NOAA stream provides estimated planetary activity before the final official index is available. citeturn620085search0turn620085search4

The planetary `ap` index is preferable to averaging Kp values directly because Kp is quasi-logarithmic. NOAA explicitly states that averaging K values is not meaningful and that equivalent-amplitude `a` indices are used to linearize the activity scale. NOAA also defines `ap` as a three-hour planetary equivalent-amplitude index, with daily Ap formed from eight three-hour values. citeturn620085search0turn620085search5

DRAKON should therefore use a NOAA-provided three-hourly planetary `ap`/estimated `ap` product as its internal geomagnetic forcing variable rather than implementing a Kp-to-ap conversion itself.

The model should nevertheless remain empirical. A single planetary index does not uniquely determine local thermospheric density because density response depends on altitude, latitude, local time, season, storm phase, and the state/history of the thermosphere. NOAA also warns that a globally averaged geomagnetic index can miss localized disturbances. citeturn620085search0turn620085search4

Accordingly, the geomagnetic correction must be treated as a bounded screening adjustment rather than as a physically exact density ratio.

## 4. External data source

### 4.1 Primary geomagnetic variable: 3-hour planetary ap

The preferred internal forcing variable is the planetary `ap` family rather than raw Kp.

NOAA SWPC documents `ap` as a three-hour planetary equivalent-amplitude measure. NOAA also reports an estimated Ap operationally because the official planetary series is finalized after the fact. citeturn620085search0turn620085search1

The implementation should consume a NOAA SWPC product that provides the latest three-hour planetary `ap` estimate and enough recent samples to reconstruct the short storm history needed by the model.

The exact NOAA endpoint and JSON schema should be verified against the live SWPC product catalog during implementation rather than hard-coded from a secondary description. The repository should store the provider URL as one named constant in `lib/geomagneticIndex.ts` so endpoint changes are localized.

NOAA's current products index confirms that SWPC exposes planetary geomagnetic products, including a real-time planetary K-index stream and related geomagnetic products. citeturn594566search0turn594566search1

### 4.2 Optional fast signal: near-real-time Kp

The existing NOAA `planetary_k_index_1m.json` feed should remain optional rather than becoming the primary model input.

Its value is operational responsiveness: it can indicate the onset or rapid change of a storm before a finalized three-hour product is available. NOAA describes the minute-by-minute K monitoring stream as a near-real-time operational estimate and distinguishes it from the finalized three-hour indices. citeturn620085search0turn620085search3

A future implementation may use this stream as a **storm-onset trigger** or freshness aid, but the first production model should derive its multiplier from the three-hour planetary `ap` series alone. This keeps the correction numerically stable and avoids mixing two index definitions in the first calibration cycle.

## 5. Requirements

The geomagnetic subsystem must satisfy the following requirements:

1. It must be fail-soft. An unavailable or invalid environmental signal must never make the re-entry page or TLE ingestion unavailable.
2. It must be time-sensitive. A 24-hour TTL is inappropriate for a storm signal whose relevant changes occur on multi-hour timescales.
3. It must preserve recent history. The multiplier cannot be based only on the newest three-hour value because atmospheric response is not guaranteed to be instantaneous.
4. It must be bounded. The correction must not overpower orbital evidence or create extreme discontinuities in lifetime estimates.
5. It must be monotonic. Greater recent geomagnetic activity must not reduce predicted drag when all other inputs are held constant.
6. It must be explainable. The risk resolver must be able to expose the activity value, observation age, multiplier, and source state.
7. It must be independently calibratable. The Kp/ap-to-multiplier curve must not be justified as a first-principles physical law.
8. It must not alter persisted historical regression semantics in the first implementation.
9. It must compose with the existing solar correction instead of replacing it.
10. It must have explicit behavior for stale, missing, malformed, and contradictory provider data.

## 6. Data architecture

The subsystem should mirror the operational pattern already established by `lib/solarFlux.ts`, while adding short-term memory because geomagnetic forcing changes much faster than F10.7.

```text
NOAA SWPC three-hour planetary ap
             |
             v
   validate + normalize sample
             |
             +--> latest sample
             |
             +--> recent 24h history
             |
             v
        Redis cache
             |
             v
  lagged/storm-state feature
             |
             v
   geomagnetic multiplier
             |
             +-------------------+
                                 |
NOAA F10.7 ----------------> solar multiplier
                                 |
                                 v
                    atmospheric correction state
                                 |
                                 v
                       resolveReentryRisk()
                                 |
                  +--------------+--------------+
                  |                             |
          single-epoch model          low-altitude fallback
```

The design intentionally keeps the environmental input out of the TLE history schema and `object_trends` persistence layer.

## 7. `lib/geomagneticIndex.ts`

Create `lib/geomagneticIndex.ts` as the environmental-data module.

Its responsibilities should mirror `lib/solarFlux.ts` where appropriate:

- fetch the NOAA product;
- validate the response schema;
- normalize timestamps and the planetary `ap` value;
- maintain a short recent observation history;
- expose the latest observation and derived storm-state features;
- calculate the empirical multiplier;
- persist/retrieve the normalized state through Redis;
- return safe defaults when data is unavailable.

The module should not contain re-entry risk-resolution logic. It should expose environmental state; `objectTrendRisk.ts` remains responsible for applying that state to an object.

### Suggested type

```typescript
type GeomagneticState = {
  ap: number;
  observedAt: string;
  ageMinutes: number;
  history: Array<{
    ap: number;
    observedAt: string;
  }>;
  stormActivity: number;
  multiplier: number;
  source: 'noaa';
  freshness: 'live' | 'stale' | 'default';
};
```

The exact type can be simplified during implementation, but the concepts should remain available for explainability.

## 8. Redis storage and freshness

Geomagnetic state should use Redis but should not rely on a single key alone.

Recommended conceptual keys:

```text
geomagnetic:latest
geomagnetic:history
```

`geomagnetic:latest` contains the newest normalized NOAA sample and short metadata.

`geomagnetic:history` contains a bounded rolling set of recent three-hour samples. A 24-hour history is sufficient for the first model because it provides eight three-hour periods while keeping the stored object extremely small.

### Freshness policy

The live sample should have a short TTL, approximately 1–3 hours, with the exact value chosen to tolerate normal product publication delays without allowing an entire storm cycle to become invisible.

The history cache should have a longer protective TTL because losing the history immediately after one failed fetch would destroy the model's lagged state. The history should therefore survive temporary provider outages long enough to support graceful degradation.

The model must distinguish:

```text
live       = recent NOAA observation available
stale      = historical state available but no fresh observation

 default    = no usable geomagnetic state available
```

The multiplier itself should fall back to `1.0` in the default case.

This preserves the existing fail-soft principle: missing external data reduces model sophistication; it does not stop DRAKON from operating.

## 9. Geomagnetic feature construction

The first implementation should not directly map the newest `ap` value to the multiplier.

Instead, derive a short-term activity feature from the recent three-hour sequence.

A suitable starting formulation is a recency-weighted activity index:

```text
activity = Σ(weight_i × ap_i) / Σ(weight_i)
```

where newer observations receive larger weights and observations outside the short memory window contribute little or not at all.

An exponentially decaying weighting is appropriate:

```text
weight_i = exp(-age_i / τ)
```

The time constant `τ` must be calibrated rather than assumed to be physically exact.

The feature should also preserve storm persistence. A single high `ap` sample followed immediately by quiet values should not produce the same multiplier as a sustained sequence of elevated `ap` values.

### Optional storm onset feature

A second scalar can capture recent acceleration:

```text
activityTrend = recentActivity - priorActivity
```

This can be used only for diagnostics or a small bounded onset adjustment. The first implementation should avoid making the final multiplier depend strongly on the derivative because a noisy estimate of storm onset can create false spikes.

## 10. Empirical multiplier model

The geomagnetic multiplier represents an estimated correction to the atmospheric-density proxy, not a complete density model.

The initial implementation should use a continuous, monotonic, bounded function.

A suitable calibration family is:

```text
multiplier = 1                                      activity <= quietThreshold
multiplier = 1 + A × f(activity)                    activity > quietThreshold
multiplier = min(multiplier, MAX_GEOMAG_MULTIPLIER)
```

where `f(activity)` is monotonic and continuous.

A practical first family is a sub-linear power or smooth exponential transition rather than a discrete Kp-style step function:

```text
multiplier = 1 + A × ((activity - threshold) / scale)^p
```

with `0 < p < 1` or another empirically selected shape.

The exact coefficients, transition point, and maximum correction are **calibration parameters**, not implementation truths. They must be kept as named constants and changed only through a documented calibration process.

### Why not a hard Kp/AP step table?

A hard threshold would introduce discontinuities in predicted lifetime. Two almost-identical environmental states could produce materially different re-entry estimates solely because an index crossed a boundary.

The correction should instead vary smoothly so the risk estimate changes continuously as environmental activity changes.

## 11. Bounding and safety policy

The geomagnetic multiplier must have an explicit upper bound:

```text
1.0 <= geomagneticMultiplier <= MAX_GEOMAG_MULTIPLIER
```

The maximum must be conservative enough that geomagnetic activity cannot overwhelm strong contradictory orbital evidence.

This is especially important because the existing decay proxies contain exponential altitude terms:

```text
exp((400 - altitude) / 60)
```

and:

```text
exp((200 - altitude) / 35)
```

A multiplicative environmental factor is therefore amplified by the already altitude-sensitive model.

The first production calibration should deliberately target a modest correction. The system should prefer under-correction to a large unvalidated storm multiplier until historical validation demonstrates that stronger values materially improve prediction quality.

## 12. Composition with the existing solar correction

The existing solar-flux correction should remain unchanged.

At the atmospheric-correction boundary, compose the signals:

```typescript
const combinedMultiplier =
  solarFluxMultiplier * geomagneticMultiplier;
```

The combined multiplier is then supplied to the existing atmospheric estimate in the same place the solar multiplier is currently applied.

The conceptual data flow becomes:

```text
F10.7 ────────────────> solarFluxMultiplier ──┐
                                             ├─> combinedMultiplier
recent planetary ap ─> geomagneticMultiplier ─┘
```

This avoids adding geomagnetic logic separately to multiple branches and prevents the two environmental effects from drifting apart between the single-epoch and low-altitude paths.

## 13. Integration points

The current application boundary suggests the following integration points:

### `lib/satelliteHelpers.ts`

`getReentryRisk()` should accept the combined environmental multiplier at the existing solar-correction boundary rather than receiving an independent geomagnetic parameter if practical.

### `lib/objectTrendRisk.ts`

`resolveReentryRisk()` should resolve the environmental correction once and pass the combined factor consistently into the single-epoch and low-altitude estimation paths.

### Re-entry screening hook

`app/dashboard/reentry/hooks/useReentryScreening.ts` and the globe-side screening orchestration should consume the resolved risk result rather than each independently querying NOAA or Redis.

This preserves the existing architectural rule that the UI does not own environmental-data semantics.

### No `CURRENT_TREND_VERSION` bump

The first implementation does not modify persisted regression features in `object_trends`. Therefore it should not require a `CURRENT_TREND_VERSION` bump.

The environmental correction is applied at final risk resolution, after historical trend data has already been computed.

## 14. Public API and observability

The geomagnetic subsystem should mirror the observability pattern used by the solar-flux subsystem.

### `/api/geomagnetic-index`

Provide a read endpoint that exposes the currently resolved environmental state without exposing provider secrets.

The response should include at minimum:

```text
ap
observedAt
ageMinutes
stormActivity
multiplier
freshness
source
```

A future extension may also expose the most recent history samples for debugging/calibration.

### `/api/tle` response headers

Expose compact metadata alongside the existing solar-flux headers:

```text
x-geomagnetic-index
x-geomagnetic-multiplier
```

The headers should represent the same environmental state that was used by the risk-resolution process.

If the correction is unavailable and defaults to `1.0`, the response should make the freshness/default state distinguishable rather than implying live NOAA data exists.

## 15. Scheduling

The geomagnetic refresh should be triggered independently from the TLE ingestion cycle.

Recommended initial cadence:

```text
NOAA geomagnetic refresh: every 1 hour
TLE ingestion:             existing schedule
Trend worker:              existing 15-minute schedule
```

The one-hour refresh is intentionally faster than the three-hour nominal data interval. It provides room for product publication delays and catches updated values without requiring a separate storm-specific scheduler.

The geomagnetic refresh endpoint should be safe to call repeatedly and should update Redis atomically enough that a partially written state cannot become the active environmental state.

The system should not make TLE ingestion wait for a geomagnetic refresh. Environmental refresh failure is independent from orbital-data ingestion.

## 16. Fail-soft behavior

The following failure matrix should be treated as part of the contract:

| Condition | Behavior |
| --- | --- |
| NOAA request succeeds with valid recent ap | Use live state |
| NOAA request succeeds but sample is older than freshness threshold | Mark stale; use bounded stale state if available |
| NOAA request fails but recent history exists | Keep last usable environmental state and mark stale |
| Redis latest missing but history exists | Derive state from history |
| Redis unavailable but no in-memory state exists | Multiplier = `1.0` |
| NOAA payload malformed | Ignore sample; preserve last valid state |
| Negative/non-finite ap | Reject sample |
| Multiplier calculation invalid | Multiplier = `1.0` |
| Multiplier outside configured bounds | Clamp to configured bounds |

No environmental failure should throw from the risk-resolution path merely because the external service is unavailable.

## 17. Explainability and Decision Trace

The geomagnetic correction should become part of the explainability contract from the beginning.

A risk explanation should eventually be able to show:

```text
Atmospheric environment
    F10.7: <value>
    Solar multiplier: <value>

    Planetary ap activity: <value>
    Geomagnetic multiplier: <value>
    Environmental multiplier: <combined value>
```

The Decision Trace should distinguish between:

- live environmental data;
- stale environmental data;
- default/no-op correction.

This matters because two re-entry estimates with identical orbital evidence may legitimately differ when the atmospheric environment differs.

The environmental correction should remain explicitly labelled as an empirical screening adjustment, not as a measured local density value.

## 18. Calibration methodology

Calibration is the highest-risk part of this feature. The `ap → multiplier` relationship should not be selected solely from qualitative space-weather intuition.

### Phase 1 — retrospective storm dataset

Build a historical set of storm and quiet windows using synchronized:

- TLE history from DRAKON;
- NOAA planetary geomagnetic activity;
- NOAA F10.7;
- Space-Track TIP predictions where available;
- observed perigee/mean-motion changes from successive TLEs.

The dataset should deliberately include both:

- strong geomagnetic storm windows;
- quiet/control windows with similar orbital populations.

### Phase 2 — parameter sweep

Evaluate multiple candidate multiplier families and parameter ranges rather than tuning one curve manually.

For each candidate, measure:

- error in estimated days remaining;
- timing bias during storm onset;
- timing bias during storm recovery;
- error at low altitude;
- false acceleration during quiet periods;
- effect on payloads versus debris;
- proportion of critical objects whose tier changes only because of the environmental correction.

### Phase 3 — TIP divergence analysis

Use the existing TIP comparison machinery to measure whether the correction reduces systematic divergence between DRAKON and external predictions.

The objective is not to force equality with TIP. The objective is to determine whether geomagnetic forcing explains a repeatable component of the divergence.

### Phase 4 — quiet-period regression test

A valid correction should remain close to neutral during quiet intervals. A candidate multiplier that produces substantial corrections during quiet control periods should be rejected even if it improves a subset of storm cases.

### Phase 5 — critical-tier safety evaluation

Before allowing the correction to influence the confidence ceiling or materially change a critical-tier classification, evaluate the maximum tier movement generated by the calibrated multiplier.

The system should document:

- maximum multiplier;
- maximum lifetime contraction;
- number of storm-period tier escalations;
- number of quiet-period false escalations;
- percentage of cases where TIP alignment improves;
- percentage where divergence worsens.

## 19. Validation against actual orbital response

TIP comparison alone is insufficient.

The strongest validation signal available to DRAKON is the measured change in orbital state itself.

For objects with adequate history, compare the model-implied drag change against observed changes in:

- perigee decay;
- semi-major-axis decay;
- mean-motion derivative;
- TLE-derived BSTAR behavior.

The purpose is to determine whether elevated geomagnetic forcing coincides with faster-than-baseline orbital decay after accounting for the existing F10.7 correction.

This should be evaluated separately by altitude bands because the same global geomagnetic forcing can produce very different drag consequences at different orbital heights.

## 20. Storm phases

The model should explicitly evaluate at least three phases:

```text
Storm onset
    geomagnetic activity rising rapidly

Storm main phase
    sustained elevated activity

Storm recovery
    geomagnetic activity falling after sustained elevation
```

This matters because a current `ap` value alone cannot distinguish an object entering the storm from an object several hours into recovery.

The short history feature should therefore be calibrated against storm phase, not only storm peak.

## 21. Non-goals

This feature must not attempt to become a complete atmospheric model.

Out of scope for the first implementation:

- direct local thermospheric density reconstruction;
- latitude/local-time dependent density enhancement maps;
- geomagnetic storm morphology or auroral-region density mapping;
- replacing SGP4/TLE propagation with numerical orbit integration;
- ingesting full WAM/DTM/NRLMSIS model outputs;
- changing the historical TLE regression model;
- treating the geomagnetic index as an authoritative re-entry prediction.

Those may become future architecture directions if DRAKON later needs higher-fidelity density modeling.

## 22. Testing strategy

### Unit tests

Add `lib/geomagneticIndex.test.ts` covering:

- valid NOAA response parsing;
- timestamp normalization;
- valid three-hour `ap` samples;
- rejection of malformed/non-finite values;
- rolling history insertion and retention;
- stale-state detection;
- default multiplier = `1.0` when no usable data exists;
- Redis failure → safe fallback;
- bounded multiplier behavior;
- monotonicity of the multiplier curve;
- known calibration fixtures producing deterministic expected multipliers.

### Integration tests

Add tests for:

- `/api/geomagnetic-index` response shape;
- `/api/tle` geomagnetic headers;
- live vs stale vs default behavior;
- combined solar × geomagnetic multiplier propagation into risk resolution;
- no regression-data mutation or trend-version invalidation.

### Regression tests

Use historical fixtures representing:

- quiet activity;
- moderate activity;
- strong storm activity;
- storm onset;
- storm recovery.

The critical invariant is:

```text
same orbital state
+ higher geomagnetic activity
= never lower modeled drag
```

while a quiet-period correction should remain near the solar-only baseline.

## 23. Operational safety gates

The feature should not be considered production-ready merely because the NOAA integration and unit tests pass.

The following gates should be satisfied before enabling the correction in operational risk scoring:

1. NOAA feed availability and schema stability verified.
2. Three-hour planetary `ap` semantics verified against live SWPC data.
3. 24-hour rolling history persisted correctly.
4. Stale/default semantics tested under provider outages.
5. Multiplier is continuous, monotonic, bounded, and numerically stable.
6. Historical storm validation completed.
7. Quiet control-window validation completed.
8. TIP divergence analysis shows a measurable improvement or a defensible neutral result.
9. No unacceptable increase in false critical/warning transitions.
10. Decision Trace can explain the environmental correction used for a result.

Until these gates are satisfied, the geomagnetic state should be observable and testable but the multiplier should remain disabled or forced to `1.0` in production.

## 24. Rollout strategy

A staged rollout is recommended.

### Stage 1 — shadow mode

Fetch, cache, and calculate the geomagnetic multiplier but do not apply it to risk. Store/log:

- latest ap;
- short-term activity feature;
- proposed multiplier;
- freshness state;
- comparison to the solar-only risk result.

### Stage 2 — analytical comparison

Run the proposed correction against historical storm/control datasets and measure model improvement.

### Stage 3 — limited risk integration

Apply the correction to single-epoch debris estimates and low-altitude fallback while keeping the confidence ceiling unchanged.

### Stage 4 — critical-tier validation

Only after retrospective validation should the correction be allowed to materially alter critical/warning states in production.

## 25. Interaction with confidence and risk tiers

The first release should **not** change the existing confidence ceiling policy.

The geomagnetic correction can change the estimated decay rate and therefore the raw estimated lifetime, but that does not mean the environmental signal itself is sufficiently trustworthy to elevate an object into a higher-confidence operational category.

During calibration, the correction should initially be prevented from bypassing existing confidence ceilings solely because of geomagnetic activity.

Once validated, any special treatment for highly disturbed low-altitude cases should be introduced as a separate documented policy decision rather than being an accidental side effect of the multiplier.

This preserves DRAKON's existing preference for evidence quality over urgency.

## 26. Future upgrade path

The architecture should leave room for a later move from scalar correction to actual density modeling.

A future environmental layer could evolve from:

```text
F10.7 + geomagnetic scalar
```

to:

```text
F10.7
+ geomagnetic history
+ solar wind / IMF features
+ latitude
+ local solar time
+ altitude
+ thermosphere model
        ↓
local neutral density
```

At that point `getReentryRisk()` would consume a density estimate rather than multiplying an empirical factor into the existing atmospheric proxy.

The proposed first implementation should therefore isolate all geomagnetic logic inside an environmental module and avoid embedding NOAA-specific or Kp/ap-specific assumptions throughout `satelliteHelpers.ts` and `objectTrendRisk.ts`.

## 27. Engineering invariants

Future changes should preserve these properties:

1. Geomagnetic data is an external environmental signal, not historical orbital evidence.
2. Missing geomagnetic data never blocks ingestion, trend computation, or risk resolution.
3. The no-data multiplier remains exactly `1.0`.
4. The production multiplier is continuous, monotonic, and explicitly bounded.
5. The three-hour planetary `ap` series is the primary model input; Kp conversion is not duplicated inside DRAKON.
6. Recent geomagnetic history is retained separately from the single latest observation.
7. Solar and geomagnetic corrections are composed multiplicatively unless calibration demonstrates a better validated composition.
8. `CURRENT_TREND_VERSION` is not changed unless persisted historical trend semantics change.
9. Geomagnetic correction does not silently bypass the existing confidence ceiling.
10. Decision Trace can identify the environmental state and multiplier used for a risk result.
11. NOAA-specific parsing remains isolated inside the environmental-data module.
12. Calibration parameters are documented and versioned.
13. Historical validation must include both storm and quiet control windows.
14. TIP is a validation/reference signal, not the target function that the geomagnetic curve is blindly fitted to.
15. The first production implementation remains an empirical correction and must not be described as a physical thermosphere model.

## 28. Verification checklist against the current DRAKON architecture

Before implementation, confirm the following current interfaces remain the integration boundaries:

```text
lib/solarFlux.ts
    ↓ existing environmental pattern
lib/satelliteHelpers.ts
    ↓ single-epoch atmospheric proxy
lib/objectTrendRisk.ts
    ↓ final risk composition / low-altitude path
app/dashboard/reentry/hooks/useReentryScreening.ts
    ↓ dashboard risk map
lib/objectTrendRisk.ts callers on globe/re-entry surfaces
    ↓ application-wide resolution
```

No change is required to:

- the persisted `object_trends` regression schema;
- `trend_jobs`;
- `trend_snapshots`;
- the TLE history partition model;
- the historical 7/14/30-day regression windows;
- payload consensus logic;
- TIP storage and comparison semantics.

The implementation should be considered complete only when the geomagnetic correction can be followed from NOAA observation through Redis state, multiplier calculation, final risk resolution, API observability, and Decision Trace without introducing a second environmental-data architecture.

## 29. References

NOAA SWPC, Station K and A Indices: K/Kp three-hour definitions, estimated real-time values, Ap semantics, and limitations. citeturn620085search0turn620085search3

NOAA SWPC, Space Weather Glossary: definitions of Kp, ap, and Ap. citeturn620085search1turn620085search4

NOAA NCEI, Geomagnetic Indices: Ap and Ap* definitions and planetary index relationships. citeturn620085search5

NOAA SWPC Products Index and JSON Product Index: current availability of planetary geomagnetic products. citeturn594566search0turn594566search1
