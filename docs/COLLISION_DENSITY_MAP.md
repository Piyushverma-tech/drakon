# Collision Density Map

## Overview

The Collision Density Map feature provides real-time visualization of crowded orbital regions and identifies potential close approaches between satellites. By computing spatial density using a voxel-based partitioning algorithm, the system highlights collision risk areas and surfaces candidate close-approach pairs for operator review.

## Feature Description

The Collision Density Map analyzes the current positions of all satellites and:

- **Identifies Active Zones**: Detects 2° geographic regions containing satellites involved in close approaches
- **Surfaces Close Approaches**: Finds satellite pairs within a configurable detection radius, with false-positive filtering
- **Visualizes Risk**: Colors satellites based on filtered close-approach counts (Cool → Warm)
- **Provides Metrics**: Displays density statistics, satellite counts, and top close-approach candidates

## Implementation Details

### Spatial Analysis Algorithm

The density computation uses a **voxel grid partitioning** approach for efficient spatial analysis:

1. **Coordinate Conversion**: Satellite positions (lat/lon/alt) are converted to ECEF (Earth-Centered, Earth-Fixed) coordinates
2. **Voxel Partitioning**: Space is divided into 3D voxels (configurable size, typically `max(detectionRadiusKm, 20)` km)
3. **Neighbor Search**: For each satellite, the algorithm examines its voxel and 26 neighboring voxels (±1 in each axis, 3×3×3 = 27 cells total)
4. **Distance Calculation**: Computes 3D Euclidean distance between satellites in the same or adjacent voxels
5. **Candidate Pair Collection**: Identifies all pairs within the detection radius before filtering

**Key design constraint**: Voxel size is set to `Math.max(detectionRadiusKm, 20)` so that the detection sphere always fits within the 27-cell neighborhood (r=1). This keeps neighbor search at O(N·26) rather than O(N·(2r+1)³).

### Two-Pass Density Pipeline

The pipeline separates raw proximity detection from filtered close-approach counting:

#### Pass 1 — Raw Proximity Detection (Pre-filter)

- All satellite pairs within the detection radius are collected
- Raw per-satellite pair counts are tracked in `rawSatDensity` for diagnostic purposes
- `maxRawSatelliteDensity` records the peak raw count

#### Pass 2 — False-Positive Filtering

Candidate pairs are filtered to remove expected proximity that doesn't represent genuine risk:

1. **Same-launch proximity**: Pairs with NORAD ID difference ≤ 5 and matching name prefix or operator are removed (likely same stack / deployment)
2. **Same-operator separation**: Pairs from the same operator within 50m are removed (intentional formation flying)
3. **Altitude co-location**: Pairs within 50m at identical altitude are removed (likely attached objects)
4. **Relative velocity check**: Pairs with relative velocity ≤ 1 m/s are removed (co-orbiting, not converging)

#### Pass 3 — Density Aggregation (Post-filter)

After filtering, the remaining pairs drive all density metrics:

- **`satDensity`**: Per-satellite filtered pair count — how many genuine close-approach partners each satellite has
- **`maxSatelliteDensity`**: Maximum filtered pair count (used as the normalization denominator for globe coloring)
- **`closeApproachSatelliteCount`**: `satDensity.size` — unique satellites with at least one filtered close approach
- **Hotspot grid**: Each unique satellite involved in a filtered pair increments its geographic cell exactly once (deduped via `countedHotspotSatellites` Set)

### Hotspot Grid

The 2° lat/lon grid counts **unique satellites with close approaches** per geographic cell, not pair events:

- Fixed at 2° resolution regardless of detection radius — ensures stable, comparable counts across radius changes
- A satellite with 10 close approaches contributes 1 count to its cell, not 10
- `totalCells` = number of 2° squares containing at least one close-approach satellite
- `maxCellCount` = the peak number of close-approach satellites in any single 2° cell ("peak zone")

**Why fixed at 2°**: Previously `gridCellSizeDeg` scaled with detection radius (2° → 3° → 4° at larger radii), which caused `totalCells` to *decrease* as radius increased — the grid coarsened faster than new satellites were added. Fixing at 2° makes hotspot counts monotonically increase with radius, which is the correct behavior.

### Visualization

#### Satellite Coloring

When the density map is enabled, satellites are colored based on their **filtered** close-approach count, normalized against `maxSatelliteDensity`:

- **0 filtered pairs (not in proximity)**: Blue `rgb(80,160,255)`
- **Low normalized density**: Cyan `rgb(120,210,255)`
- **Medium**: Green `rgb(60,200,140)`
- **Medium-High**: Yellow `rgb(255,255,120)`
- **High**: Orange → Red `rgb(255,140,60) → rgb(255,50,50)`

Color normalization uses only filtered pair counts. Raw (pre-filter) counts are not used for coloring to prevent same-constellation satellites (e.g., Starlink) from distorting the color scale.

#### Close Approach Lines

- **Visualization**: deck.gl `LineLayer` between the top 50 filtered close-approach pairs
- **Color Coding**:
  - **Pink** `[255, 80, 200]`: Distance ≤ half the detection radius (closer risk)
  - **Amber** `[255, 200, 200]`: Distance within the full detection radius

### User Interface

#### Statistics Display

| Stat | Source | Description |
|------|--------|-------------|
| Active zones | `stats.totalCells` | 2° cells containing ≥1 close-approach satellite |
| Satellites | `stats.closeApproachSatelliteCount` | Unique satellites with ≥1 filtered close approach |
| Close approaches | `stats.totalCandidatePairs` | Total filtered pairs (before 50-pair display cap) |
| Showing X/Y pairs | `displayedCandidatePairs / totalCandidatePairs` | Display cap transparency |
| Peak zone | `stats.maxCellCount` | Max close-approach satellites in any single 2° cell |

**Loading indicator**: `densityLoading` is set to `true` immediately when inputs change (before the 500ms debounce fires), so the spinner appears during the debounce window rather than only during worker computation.

#### Top Close Approaches List

Displays the top 50 closest filtered satellite pairs:

- **NORAD IDs**: Both satellites in the pair (clicking focuses the lower-ID satellite)
- **Altitudes**: Individual altitudes of both satellites
- **Distance**: Formatted distance (meters for <1km, kilometers for ≥1km), colored red if ≤ half the detection radius

## Stats Shape (`DensityResult.stats`)

```typescript
stats: {
  totalSatellites: number;          // input satellite count
  totalCells: number;               // active 2° zones (stable — fixed grid resolution)
  maxCellCount: number;             // peak close-approach satellites per 2° cell
  totalCandidatePairs: number;      // all filtered pairs found (before display cap)
  displayedCandidatePairs: number;  // pairs returned for rendering (≤ maxPairs = 50)
  closeApproachSatelliteCount: number; // unique satellites in filtered pairs
  maxSatelliteDensity: number;      // max filtered pair count — normalization denominator
  maxRawSatelliteDensity: number;   // max raw (pre-filter) pair count — diagnostic only
  detectionRadiusKm: number;
  voxelSizeKm: number;
  gridCellSizeDeg: number;          // always 2
}
```

## Performance Optimizations

### Worker-Based Computation

All density calculations run in a Comlink Web Worker (`lib/workers/satellite.worker.ts`), preventing UI blocking at 17k+ satellites.

### Debouncing

500ms debounce on inputs. `densityLoading` is set immediately on input change so the spinner shows during the debounce window, not just during worker execution.

### Voxel Size Constraint

`voxelSizeKm = Math.max(detectionRadiusKm, 20)` keeps neighbor search at exactly 27 cells (r=1). If voxels were smaller than the detection radius, r would grow and the search would expand to 125+ cells with no accuracy benefit.

### Caching

Density results are cached in `satelliteWorker.ts` keyed on `(positionHash, radius, voxelSize, gridCellSizeDeg, maxPairs)`. The hash rounds positions to avoid cache misses from floating-point drift between 5s position updates.

## Configuration Parameters

### Detection Radius

- **Small (10–50 km)**: Tight close approaches, fewer pairs. Best for LEO screening.
- **Medium (50–100 km)**: Balanced for LEO operations.
- **Large (100–250 km)**: Broader screening for MEO/GEO. Voxels grow proportionally so the 27-cell neighborhood constraint is maintained, but very large voxels mean each voxel may contain many satellites, increasing inner-loop cost. A practical cap on `voxelSizeKm` of ~100km is advisable at large radii.

### Grid Cell Size

Fixed at **2°** regardless of detection radius. This ensures:
- Hotspot counts are stable and comparable across radius settings
- `totalCells` increases monotonically as more satellites enter close-approach range
- No resolution change that would make metrics incomparable between slider positions

## Overall Data Flow

```
useSatellitePositions / useSimulatedPositions
  └─ activeSatellites (every 5s or on simulation offset)
       └─ useCollisionDensity (showDensity = true)
            ├─ setDensityLoading(true)  ← immediate, before debounce
            └─ setTimeout(500ms)
                 └─ computeCollisionDensityAsync(payload, options)
                      └─ Comlink → satellite.worker.ts
                           ├─ Pass 1: Voxel grid + raw pair collection
                           ├─ Pass 2: filterCandidatePairs (same-launch, velocity, etc.)
                           └─ Pass 3: satDensity + hotspot grid + limitedPairs
                 └─ DensityResult → setDensityResult
                      ├─ satelliteDensities → normalized Map<id, 0–1> in hook
                      └─ RightPanel + ScatterplotLayer + LineLayer
```

## Limitations and Known Behavior

1. **Snapshot analysis**: Density reflects positions at computation time. Positions update every 5s, so stats fluctuate slightly between recomputes as satellites cross cell boundaries.
2. **TLE accuracy**: Results depend on TLE recency. Stale TLEs produce inaccurate positions.
3. **Filtering heuristics**: The same-launch and same-operator filters reduce false positives but may suppress legitimate close approaches between satellites of the same operator at different altitudes.
4. **Display cap**: Only the 50 closest filtered pairs are returned for rendering. `totalCandidatePairs` reflects the full count before this cap.
5. **No velocity prediction**: Pairs are detected at current positions only. Two satellites currently 70km apart but converging at 10km/s may reach closest approach in minutes — this is not modeled.

## Future Enhancements

- **Predictive density**: Project positions forward T+0→T+24h and sweep pair counts over time (conjunction timeline)
- **Orbital plane filtering**: Only flag pairs in similar orbital planes (low relative inclination)
- **Solar activity correction**: F10.7 flux adjustment for atmospheric drag at low altitudes
- **Space-Track CDM integration**: Replace heuristic filtering with official Conjunction Data Messages
- **Alert thresholds**: Configurable distance thresholds that trigger persistent alerts

## Related Documentation

- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [Re-Entry Risk Screening](./REENTRY_RISK.md)
- [README — Performance Optimizations](../README.md#performance-optimizations)
