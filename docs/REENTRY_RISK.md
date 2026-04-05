# Re-entry Risk Screening

## Overview

Re-entry risk screening identifies orbital objects that are actively decaying and likely to re-enter Earth's atmosphere within a meaningful time window. The feature surfaces these objects on the globe (colored by risk tier), in the RightPanel as a ranked list, and in the LeftPanel when a specific satellite is selected.

The core constraint driving every decision in this feature: **a single TLE epoch contains limited decay information, and most of it is unreliable for maneuvering satellites.**

---

## Data Source: BSTAR Drag Term

All decay estimates derive from the BSTAR drag term embedded in TLE line 1, columns 53–60 (0-indexed).

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

| Tier | Condition | Globe color |
|---|---|---|
| Critical | < 30 days | Red-orange `[255, 60, 40, 230]` |
| Warning | 30–180 days | Amber `[255, 160, 30, 210]` |
| Nominal | 180–365 days | Yellow `[255, 220, 80, 180]` |
| Stable | > 365 days, null, or filtered out | Not shown in re-entry mode |

When re-entry mode is active, objects not in the risk map are dimmed to `[60, 60, 80, 100]` so at-risk objects pop visually against the globe.

---

## Object Classification Filter

### The core problem

The most significant implementation challenge was that BSTAR is **corrupted by maneuvers** for actively controlled satellites. Early versions of the feature showed thousands of false positives — operational Starlink satellites at 547km appearing as 25-day re-entry risks because their BSTAR values reflected recent orbital maintenance burns, not drag.

Notable example: **Starlink Direct-to-Cell (DTC) satellites** operate at 367km (below the initial 450km altitude gate). These are fully operational satellites providing cellular coverage to unmodified phones. They appeared critical in early versions because their low altitude combined with maneuver-contaminated BSTAR produced plausible-looking but completely wrong decay estimates.

### Decision: filter by object type, not altitude

The final filter is categorical, not altitude-based:

```typescript
const isRocketBody = nameUpper.includes('R/B') || nameUpper.includes('ROCKET');
const isDebrisObject = entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');
const isLikelyActive = !isDebrisObject && !isRocketBody;

if (isLikelyActive) return stable;
```

**Only debris objects and rocket bodies are screened.** All other objects, regardless of altitude or BSTAR magnitude, are returned as stable.

This is a conservative choice that prioritizes precision over recall.

### Additional sanity gates

```typescript
// No meaningful drag
if (Math.abs(bstar) < 1e-5) return stable;

// GEO / deep space — atmospheric drag negligible
if (periodMin > 600 || altKm > 2000) return stable;

// Anomalous BSTAR — almost certainly bad TLE data
if (decayRateKmPerDay > 20) return stable;

// Beyond useful screening horizon
if (rawDays > 3650) return stable;
```

The 20 km/day cap deserves explanation: at LEO altitudes, even the most aggressively decaying debris rarely loses more than 5–10km/day in its final weeks. Values above 20 km/day almost always indicate a stale TLE where BSTAR has been incorrectly fitted, not a genuinely fast-decaying object.

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
useEffect(() => { reentryRisksRef.current = reentryRisks; }, [reentryRisks]);

// Inside getFillColor:
const risk = reentryRisksRef.current.get(d.id);
```

---

## Implementation Tradeoffs

### BSTAR vs. mean motion derivative (Ṅ)

TLE line 1 also encodes Ṅ (first derivative of mean motion, cols 33–43), which directly measures orbital period shortening. Ṅ is a cleaner signal for decay than BSTAR because:

- Instantaneous maneuvers affect velocity but have less impact on the Ṅ trend across a tracking arc
- Positive Ṅ definitively indicates a decaying orbit

However, Ṅ is still contaminated by maneuvers to a lesser degree, and using both BSTAR and Ṅ together does not eliminate the fundamental problem for maneuvering satellites. The decision was made to use BSTAR only for simplicity, since the object type filter already handles the maneuvering satellite problem at the classification level.

Ṅ would be worth adding as a secondary validation signal for debris objects where both signals should agree.

### Single epoch vs. multi-epoch trending

The definitive method for distinguishing a genuinely decaying active satellite from a maneuvering one is to track BSTAR and Ṅ trends across multiple consecutive TLE epochs. If BSTAR is consistently high and increasing over 7–14 days, the satellite is almost certainly dead and decaying regardless of its nominal classification.

This approach was not implemented because it requires historical TLE storage, which is a backend feature. The current implementation is intentionally scoped to what single-epoch data can support reliably.

### Accuracy ceiling

The formula is validated to order-of-magnitude accuracy for non-maneuvering LEO objects. Factors not modeled:

- **Solar activity (F10.7 flux)** — solar maximum can increase atmospheric density at 400km by 10× compared to solar minimum, compressing re-entry timelines dramatically
- **Geomagnetic storms** — short-term density spikes that can accelerate decay by days
- **Object attitude and tumbling** — a tumbling rocket body has a different effective drag cross-section than a stable one
- **Orbital eccentricity** — the formula assumes near-circular orbits; eccentric orbits spend different fractions of time at different altitudes

These limitations are surfaced to the user via the disclaimer: *"Estimates from BSTAR drag term only. Accuracy ±order of magnitude. Solar activity not modeled."*

---

## Files Changed

| File | Change |
|---|---|
| `lib/types.ts` | Added `ReentryRisk` type |
| `lib/satelliteHelpers.ts` | Added `parseBSTAR()`, `estimateAltitudeFromMeanMotion()`, `getReentryRisk()` |
| `lib/visualization-slice.ts` | Added `showReentry` state and `setShowReentry` action |
| `components/SatelliteGlobe.tsx` | `reentryRisks` useMemo, ref pattern, color logic, prop pass-down |
| `components/panels/RightPanel.tsx` | Re-entry Risk section with toggle, summary counts, ranked list |
| `components/panels/LeftPanel.tsx` | Re-entry section in satellite detail panel |

---

## Future Improvements

### Near-term (single-epoch data, no backend changes)

**Add Ṅ as secondary signal for debris**
Parse `parseMeanMotionDot(l1)` from cols 33–43. For debris objects where both BSTAR and Ṅ indicate decay, confidence in the estimate is higher. Objects where only one signal is elevated can be flagged with lower confidence. This does not require any backend work.

**Altitude-stratified thresholds**
The 20 km/day decay rate cap and tier thresholds (30/180/365 days) are currently uniform across all altitudes. Objects at 200km genuinely decay faster than objects at 500km. Stratified thresholds by altitude shell would reduce false positives at high altitudes and false negatives at very low altitudes.

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
