# Re-entry Risk Screening

## Overview

Re-entry risk screening identifies orbital objects that are actively decaying and likely to re-enter Earth's atmosphere within a meaningful time window. The feature surfaces these objects on the globe (colored by risk tier), in the RightPanel as a ranked list, and in the LeftPanel when a specific satellite is selected.

The core constraint driving every decision in this feature: **a single TLE epoch contains limited decay information, and most of it is unreliable for maneuvering satellites.**

---

## Data Source: BSTAR Drag Term

Current decay estimates derive from the BSTAR drag term embedded in TLE line 1, columns 53–60 (0-indexed). The parser also captures mean motion derivative, `meanMotionDot` / Ṅ, from line 1 columns 33–42 (0-indexed) so it can be used as a secondary decay signal.

### Format

```
1 25544U 98067A   24001.50000000  .00002182  00000-0  15519-4 0  9993
                                                       ^^^^^^^
                                                       BSTAR field
```

BSTAR uses a packed decimal notation: `±NNNNN±N`, representing `0.NNNNN × 10^(±N)`. The leading sign uses a space for positive values, not `+`. Parsing requires padding to 8 characters before extracting the mantissa and exponent signs.

### What BSTAR actually measures

BSTAR is not a direct measurement of atmospheric drag. It is a least-squares fitting coefficient computed by the SGP4 orbit determination process from radar tracking observations. It absorbs:

- Actual atmospheric drag (what we want)
- Maneuver residuals from propulsion burns (noise)
- Tracking measurement errors (noise)

For a non-maneuvering object, BSTAR converges toward the true drag coefficient over successive TLE updates as the fitter accumulates longer unperturbed tracking arcs. For a maneuvering satellite, BSTAR is essentially meaningless for decay prediction.

---

## Decay Rate Formula

### Derivation

BSTAR has units of `(Earth radii)⁻¹`. The altitude decay rate is derived from the two-body energy relation combined with the SGP4 drag model:

```
da/dt = -2 × B* × ρ_ref × R_earth × v  [Earth-radii per second]
```

Simplified to km/day for screening purposes, with a scale height correction for atmospheric density variation across altitude:

```
decayRate (km/day) = |BSTAR| × BASE_FACTOR × densityFactor × (v / v_ref)
```

Where:

- `BASE_FACTOR = 7.4e5` — derived from SGP4 reference density ρ₀ = 2.461×10⁻⁵ kg/m²/Re
- `densityFactor = exp((400 - altKm) / 60)` — exponential scale height correction, H = 60km
- `v_ref = 7.905 km/s` — circular velocity at sea level
- `v = sqrt(MU / (R_earth + alt))` — current orbital velocity

### Scale height rationale

Atmospheric density approximately halves every 60km in the 200–600km range. The `exp((REF_ALT - alt) / H)` term corrects for this. Without it, objects at 500km would appear to decay as fast as objects at 300km, which is physically wrong.

### Lifetime estimate

```
estimatedDays = ceil((altKm - 120) / decayRate)
```

120km is the nominal re-entry threshold where aerodynamic heating becomes terminal. Objects below this altitude are considered to have already re-entered. `ceil` is used instead of `round` to avoid displaying `~0d` for objects with hours remaining.

---

## Risk Tiers

| Tier     | Condition                                  | Globe color                     |
| -------- | ------------------------------------------ | ------------------------------- |
| Critical | < 30 days                                  | Red-orange `[255, 60, 40, 230]` |
| Warning  | Above critical, below altitude-aware limit | Amber `[255, 160, 30, 210]`     |
| Nominal  | Above warning, below altitude-aware limit  | Yellow `[255, 220, 80, 180]`    |
| Stable   | Beyond limit, null, or filtered out        | Not shown in re-entry mode      |

The critical cutoff intentionally stays fixed at 30 days. A near-term re-entry estimate is operationally important even when altitude uncertainty is high. The longer-horizon tiers are stricter at high altitude, where single-epoch BSTAR is less reliable: below 300km the warning/nominal limits remain 180/365 days; by 800km they compress to 90/180 days; by 1000km they compress to 60/120 days; by 2000km they compress to 45/90 days.

### Confidence signal

`meanMotionDot` is used as a secondary validation signal. A positive Ṅ above `1e-6 rev/day²` agrees with the BSTAR-derived decay signal and raises confidence to `high`. If the signals agree above 500km, one suppressed tier band is restored because two independent single-epoch decay signals are more credible than BSTAR alone. If Ṅ does not confirm the BSTAR-derived signal, confidence is `medium` below 500km and `low` above 500km. The LeftPanel displays this confidence and whether the N-dot signal agrees.

When re-entry mode is active, objects not in the risk map are dimmed to `[60, 60, 80, 100]` so at-risk objects pop visually against the globe.

---

## Object Classification Filter

### The core problem

The most significant implementation challenge was that BSTAR is **corrupted by maneuvers** for actively controlled satellites. Early versions of the feature showed thousands of false positives — operational Starlink satellites at 547km appearing as 25-day re-entry risks because their BSTAR values reflected recent orbital maintenance burns, not drag.

Notable example: **Starlink Direct-to-Cell (DTC) satellites** operate at 367km (below the initial 450km altitude gate). These are fully operational satellites providing cellular coverage to unmodified phones. They appeared critical in early versions because their low altitude combined with maneuver-contaminated BSTAR produced plausible-looking but completely wrong decay estimates.

### Decision: filter by object type, not altitude

The final filter is categorical, not altitude-based:

```typescript
const isDebrisObject =
  entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');

if (!isDebrisObject) return stable;
```

**Only objects classified as debris are screened.** Rocket bodies are included in that classification upstream when TLE text is parsed (`R/B`, `RKT`, and `ROCKET` names set `entry.isDebris = true`). `getReentryRisk()` intentionally does not keep a separate rocket-body name check, so the screening boundary stays in one place instead of relying on duplicated classification logic.

This is a conservative choice that prioritizes precision over recall.

### Additional sanity gates

```typescript
// GEO / deep space — atmospheric drag negligible
if (periodMin > 600 || altKm > 2000) return stable;

// No meaningful decay after altitude-adjusted drag calculation
if (decayRateKmPerDay < 1e-4) return stable;

// Anomalous BSTAR — altitude-aware, because terminal decay can exceed 20 km/day
if (decayRateKmPerDay > maxPlausibleDecayRateKmPerDay(altKm)) return stable;

// Beyond useful screening horizon
if (rawDays > 3650) return stable;
```

The decay-rate anomaly guard is altitude-aware. The original flat `20 km/day` cap was only appropriate around mid-LEO; at very low altitudes, especially below about 180km, terminal decay can legitimately exceed that rate. The guard now keeps the 20 km/day ceiling for objects at or above 300km, raises the allowed ceiling exponentially between 180–300km, and disables the cap below 180km.

The old fixed `|BSTAR| < 1e-5` pre-filter was also removed. Whether BSTAR is meaningful depends on altitude: a small BSTAR at 150km can still produce a physically significant decay rate after density scaling. The remaining low-signal gate is applied to the computed `decayRateKmPerDay` instead.

---

## Performance Design

### No worker, no async

Re-entry risk computation runs entirely in a `useMemo` over `entries[]` — synchronous, sub-millisecond for 15K objects. The formula involves only arithmetic: one square root, one exponential, and a handful of multiplications per object.

### Dependency isolation

```typescript
const reentryRisks = useMemo(() => {
  if (!showReentry) return new Map();
  // ...
}, [showReentry, entries]); // NOT activeSatellites
```

`activeSatellites` is deliberately excluded from dependencies. This is the key performance decision: re-entry risk is derived from static TLE parameters (BSTAR, meanMotion), not live SGP4 positions. Including `activeSatellites` would cause the computation to re-run every 5 seconds on the position update cycle, causing visible UI freezes at 15K objects.

The live altitude from SGP4 is marginally more accurate than `estimateAltitudeFromMeanMotion`, but the difference is negligible for a screening tool with ±order-of-magnitude accuracy.

### Ref pattern for layer closure

Since `reentryRisks` is excluded from the `layers` useMemo dependencies, a ref is used to give the `getFillColor` closure access to the current map without triggering layer recomputation:

```typescript
const reentryRisksRef = useRef(reentryRisks);
useEffect(() => {
  reentryRisksRef.current = reentryRisks;
}, [reentryRisks]);

// Inside getFillColor:
const risk = reentryRisksRef.current.get(d.id);
```

---

## Implementation Tradeoffs

### BSTAR vs. mean motion derivative (Ṅ)

TLE line 1 also encodes Ṅ (first derivative of mean motion, cols 33–43), which directly measures orbital period shortening. Ṅ is a cleaner signal for decay than BSTAR because:

- Instantaneous maneuvers affect velocity but have less impact on the Ṅ trend across a tracking arc
- Positive Ṅ definitively indicates a decaying orbit

However, Ṅ is still contaminated by maneuvers to a lesser degree, and using both BSTAR and Ṅ together does not eliminate the fundamental problem for maneuvering satellites. The object type filter remains the primary protection against maneuver-contaminated active satellites. For debris objects, Ṅ is used as a confidence signal: when positive Ṅ agrees with a BSTAR-derived decay estimate, the result is treated as higher confidence.

### Single epoch vs. multi-epoch trending

The definitive method for distinguishing a genuinely decaying active satellite from a maneuvering one is to track BSTAR and Ṅ trends across multiple consecutive TLE epochs. If BSTAR is consistently high and increasing over 7–14 days, the satellite is almost certainly dead and decaying regardless of its nominal classification.

This approach was not implemented because it requires historical TLE storage, which is a backend feature. The current implementation is intentionally scoped to what single-epoch data can support reliably.

### Accuracy ceiling

The formula is validated to order-of-magnitude accuracy for non-maneuvering LEO objects. Factors not modeled:

- **Solar activity (F10.7 flux)** — solar maximum can increase atmospheric density at 400km by 10× compared to solar minimum, compressing re-entry timelines dramatically
- **Geomagnetic storms** — short-term density spikes that can accelerate decay by days
- **Object attitude and tumbling** — a tumbling rocket body has a different effective drag cross-section than a stable one
- **Orbital eccentricity** — the formula assumes near-circular orbits; eccentric orbits spend different fractions of time at different altitudes

These limitations are surfaced to the user via the disclaimer: _"Estimates from BSTAR drag term only. Accuracy ±order of magnitude. Solar activity not modeled."_

---

## Files Changed

| File                               | Change                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `lib/types.ts`                     | Added `ReentryRisk` type                                                     |
| `lib/satelliteHelpers.ts`          | Added `parseBSTAR()`, `parseMeanMotionDot()`, `estimateAltitudeFromMeanMotion()`, `getReentryRisk()` |
| `lib/visualization-slice.ts`       | Added `showReentry` state and `setShowReentry` action                        |
| `components/SatelliteGlobe.tsx`    | `reentryRisks` useMemo, ref pattern, color logic, prop pass-down             |
| `components/panels/RightPanel.tsx` | Re-entry Risk section with toggle, summary counts, ranked list               |
| `components/panels/LeftPanel.tsx`  | Re-entry section in satellite detail panel                                   |

---

## Future Improvements

### Near-term (single-epoch data, no backend changes)

**Calibrate confidence thresholds**
`meanMotionDot` now acts as a secondary confidence signal. The current threshold is intentionally simple (`> 1e-6 rev/day²`); it should be calibrated against historical decays once multi-epoch data is available.

**Tune altitude-stratified thresholds**
Tier thresholds now keep the critical cutoff fixed while compressing warning and nominal limits at high altitude. Further tuning can be done against historical re-entry cases once multi-epoch data is available.

**Scale height refinement**
The H = 60km scale height is a rough average for 200–600km. NRLMSISE-00 atmospheric model tables would give more accurate density corrections by altitude, but would require embedding a lookup table.

### Medium-term (requires backend, fits existing roadmap)

**Multi-epoch BSTAR trending**
The PostgreSQL schema already includes a `tle_history` table. Once historical TLEs are stored, compute a rolling BSTAR slope over the last 7–14 days. A consistently increasing BSTAR trend for an active satellite is a reliable indicator that it has stopped maneuvering. This closes the main gap in the current approach — genuinely dead active satellites that haven't been reclassified as debris.

**Solar activity correction**
Fetch the current F10.7 solar flux index (NOAA publishes it daily) and apply a density multiplier to the decay formula. This alone can change re-entry estimates by a factor of 2–5× during solar maximum, which is the difference between "nominal" and "critical" for many objects.

**Confidence interval display**
Rather than showing a single `~13d` estimate, show a range `~8–20d` based on known uncertainty bounds. The ±order-of-magnitude claim in the disclaimer could be formalized into a displayed range using the F10.7 min/max density bounds for the current solar cycle phase.

### Long-term (requires external data integration)

**Space-Track conjunction data message (CDM) integration**
The real professional tool for this is conjunction screening against Space-Track's CDM feed, which includes probability of collision and re-entry predictions from 18th Space Defense Squadron. DRAKON's API routes are already structured to support this — it would require a Space-Track account and a backend job to fetch and cache CDMs.

**Atmospheric drag model (NRLMSISE-00)**
Replace the exponential scale height approximation with the full NRLMSISE-00 atmospheric density model. This is the same model used in professional SGP4 implementations. JavaScript ports exist. Combined with real-time F10.7 input, this would bring accuracy to ±20% rather than ±order-of-magnitude.

**Re-entry footprint prediction**
For objects within 7 days of re-entry, show a ground footprint corridor on the globe — the range of longitudes where surviving debris could reach the surface based on the orbital inclination and uncertainty in re-entry time. This is the visualization that makes re-entry data operationally useful for safety planning.

## Related Documentation

- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [Performance Optimizations](../README.md#performance--heavy-compute-offload)
