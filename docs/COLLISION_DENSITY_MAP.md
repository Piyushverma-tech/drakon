# Collision Density Map — Notes

Real-time visualization of crowded orbital regions + candidate close-approach pairs, via voxel-based spatial partitioning.

## Algorithm

1. Convert lat/lon/alt → ECEF coordinates
2. Voxel grid partition, size = `max(detectionRadiusKm, 20)` km — keeps detection sphere within the 27-cell (3×3×3, r=1) neighborhood, so neighbor search stays O(N·26) instead of O(N·(2r+1)³)
3. For each satellite, check its voxel + 26 neighbors, compute 3D Euclidean distance
4. Collect all candidate pairs within detection radius before filtering

Practical cap: `voxelSizeKm` ~100km at large radii — bigger voxels hold more satellites, raising inner-loop cost even though cell count constraint holds.

## Two-Pass Pipeline

**Pass 1 (pre-filter)**: raw proximity detection. `rawSatDensity` = per-satellite raw pair counts (diagnostic only). `maxRawSatelliteDensity` = peak raw count.

**Pass 2 (filtering)** — removes expected/non-genuine proximity:

1. Same-launch: NORAD ID diff ≤5 + matching name prefix/operator → removed (same stack)
2. Same-operator within 50m → removed (formation flying)
3. Same altitude within 50m → removed (attached objects)
4. Relative velocity ≤1 m/s → removed (co-orbiting, not converging)

**Pass 3 (post-filter aggregation)**:

- `satDensity`: per-satellite filtered pair count
- `maxSatelliteDensity`: max filtered count (normalization denominator for coloring)
- `closeApproachSatelliteCount` = `satDensity.size`
- Hotspot grid: each satellite counted once per cell (deduped via `countedHotspotSatellites` Set), not once per pair

## Hotspot Grid

Fixed at **2° lat/lon resolution regardless of detection radius** (deliberately not scaled with radius — a scaling grid coarsened faster than satellites were added, causing `totalCells` to decrease as radius increased). Fixed 2° makes hotspot counts monotonically increase with radius.

- `totalCells` = # of 2° cells with ≥1 close-approach satellite
- `maxCellCount` = peak close-approach satellites in any single cell ("peak zone")

## Visualization

**Satellite coloring** — by filtered close-approach count normalized against `maxSatelliteDensity` (raw counts never used for coloring, to prevent constellations like Starlink from distorting the scale):

- 0 pairs: Blue `rgb(80,160,255)`
- Low: Cyan `rgb(120,210,255)`
- Medium: Green `rgb(60,200,140)`
- Medium-high: Yellow `rgb(255,255,120)`
- High: Orange→Red `rgb(255,140,60)→rgb(255,50,50)`

**Close approach lines** — deck.gl `LineLayer`, top 50 filtered pairs.

- Pink `[255,80,200]`: distance ≤ half detection radius
- Amber `[255,200,200]`: within full detection radius

## Stats

| Stat              | Source                                          |
| ----------------- | ----------------------------------------------- |
| Active zones      | `stats.totalCells`                              |
| Satellites        | `stats.closeApproachSatelliteCount`             |
| Close approaches  | `stats.totalCandidatePairs`                     |
| Showing X/Y pairs | `displayedCandidatePairs / totalCandidatePairs` |
| Peak zone         | `stats.maxCellCount`                            |

```typescript
stats: {
  (totalSatellites,
    totalCells,
    maxCellCount,
    totalCandidatePairs,
    displayedCandidatePairs,
    closeApproachSatelliteCount,
    maxSatelliteDensity,
    maxRawSatelliteDensity,
    detectionRadiusKm,
    voxelSizeKm,
    gridCellSizeDeg); // always 2
}
```

Top Close Approaches list: top 50 closest filtered pairs, both NORAD IDs (click focuses lower ID), both altitudes, distance (m if <1km else km, red if ≤half detection radius).

## Performance

- All computation runs in a Comlink Web Worker (`lib/workers/satellite.worker.ts`) — prevents UI blocking at 17k+ satellites
- 500ms debounce on inputs; `densityLoading` set true immediately on input change (before debounce fires) so spinner shows during debounce window
- Cache keyed on `(positionHash, radius, voxelSize, gridCellSizeDeg, maxPairs)` in `satelliteWorker.ts`; hash rounds positions to avoid floating-point-drift cache misses between 5s position updates

## Config Parameters

**Detection radius**:

- Small (10–50km): tight, fewer pairs — LEO screening
- Medium (50–100km): balanced LEO ops
- Large (100–250km): broader MEO/GEO screening; voxel cap ~100km advisable

**Grid cell size**: fixed 2° always.

## Data Flow

```
useSatellitePositions/useSimulatedPositions (every 5s or sim offset)
  → useCollisionDensity (showDensity=true)
    → setDensityLoading(true) immediately
    → 500ms debounce → computeCollisionDensityAsync
      → Comlink → satellite.worker.ts
        Pass1: voxel grid + raw pairs
        Pass2: filterCandidatePairs
        Pass3: satDensity + hotspot grid + limitedPairs
      → DensityResult → setDensityResult
        → satelliteDensities (normalized Map<id,0-1>)
        → RightPanel + ScatterplotLayer + LineLayer
```

## Known Limitations

1. Snapshot analysis — positions update every 5s, stats fluctuate as satellites cross cell boundaries
2. Depends on TLE recency
3. Same-launch/same-operator filters may suppress legitimate close approaches between same-operator satellites at different altitudes
4. Display capped at 50 pairs (`totalCandidatePairs` shows full count)
5. No velocity prediction — pairs detected at current positions only, doesn't model fast convergence

## Future Ideas

- Predictive density (T+0→T+24h conjunction timeline)
- Orbital plane filtering (low relative inclination only)
- Solar activity (F10.7) correction for drag
- Space-Track CDM integration to replace heuristic filtering
- Configurable alert thresholds

## Related

- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [Re-Entry Risk Screening](./REENTRY_RISK.md)
