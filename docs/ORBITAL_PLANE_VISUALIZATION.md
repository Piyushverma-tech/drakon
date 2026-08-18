# Orbital Plane Visualization

DRAKON's orbital-plane visualization provides three related ways to understand orbital geometry and satellite motion: inclination-band analysis, a representative ground track for the selected orbital shell, and per-satellite temporal/orbital paths for selected objects.

The visualization is intended to answer three different questions:

- **Orbital structure:** Which satellites occupy a similar inclination shell?
- **Orbital footprint:** What geographic path is representative of that shell?
- **Object motion:** Where has a selected satellite been, where is it going, and what does its complete orbit look like in 3D?

All positions and paths are generated from TLE state vectors using SGP4 propagation through `satellite.js`.

## 1. Inclination Band Analysis

An inclination band is defined by a target inclination and a symmetric tolerance:

```text
|satellite.inclination - targetInclination| <= tolerance
```

Every TLE entry satisfying the condition becomes a member of the selected band. Membership is stored in a `Set<number>` for constant-time lookup during rendering.

The current controls are:

- **Inclination:** 0–120°, step 0.5°, default 53°
- **Tolerance:** 0.5–10°, step 0.5°, default 2°
- **Band toggle:** enables or disables band analysis and highlighting

A smaller tolerance isolates a more specific orbital shell. A larger tolerance captures a broader family of similarly inclined orbits.

### Band statistics

The band calculation provides:

- Number of satellites whose inclination falls within the selected band
- Average altitude of those satellites, using currently propagated satellite positions where available
- Current target inclination and tolerance range

The average altitude is therefore a snapshot statistic, while inclination membership comes from the orbital elements in the TLE entries.

## 2. Representative Orbital-Band Ground Track

The selected inclination band is represented visually by one ground track rather than drawing a separate track for every member.

The representative satellite is selected by sorting band members by mean motion and choosing the median entry. This makes the representative period less sensitive to unusually high- or low-period members within the band.

The representative TLE is propagated over one complete orbital period using 240 samples:

```text
orbital period = 2π / meanMotion
sample time    = start + i / 240 × orbital period
```

The resulting `[longitude, latitude]` path is rendered as a deck.gl `PathLayer`.

The band track is intentionally a representative geographic footprint, not a geometric rendering of every orbital plane in the band. It shows the spatial behavior of the selected inclination shell while avoiding unnecessary visual and computational clutter.

The track is split at antimeridian crossings before rendering so that a path crossing ±180° longitude does not create an artificial line across the globe.

### Rendering

- deck.gl `PathLayer`
- Cyan path
- Approximately 70% opacity
- 1.5px minimum / 2px visual width
- Longitude wrapping enabled

The representative track is recalculated when the debounced inclination or tolerance changes.

## 3. Selected Satellite Track — 2D Temporal Visualization

A selected satellite can display a temporal ground track showing approximately one orbital period into the past and one orbital period into the future relative to the current visualization time.

For a selected TLE:

1. SGP4 is propagated to the selected center time.
2. The orbital period is derived from mean motion.
3. The past interval covers `centerTime - one period → centerTime`.
4. The future interval covers `centerTime → centerTime + one period`.
5. Each direction is sampled at 120 points.
6. The resulting longitude/latitude path is split at antimeridian crossings.

The worker internally carries a normalized temporal parameter with each point:

```text
past:   1.0 → 0.0   oldest → current position
future: 0.0 → 1.0   current position → furthest future point
```

That parameter is converted into segment opacity. The current position is therefore visually emphasized while the path fades with temporal distance.

The final 2D representation is rendered with deck.gl `PathLayer` segments. Each selected satellite receives its own stable color, allowing multiple selected satellites to be compared simultaneously.

This visualization represents **propagated ground position**, not a prediction of future maneuvering or a covariance envelope. Its accuracy is bounded by the underlying TLE and SGP4 model.

### 2D track rendering

- `PathLayer`
- Longitude/latitude coordinates
- 120 samples per direction
- One orbital period past + one orbital period future
- Antimeridian-aware segmentation
- Opacity encodes temporal distance from the selected satellite's current position
- Selected satellites retain their assigned visualization color

## 4. Selected Satellite Orbit Path — 3D Orbital Visualization

The 3D orbit-path visualization complements the 2D temporal track by showing the satellite's orbital trajectory in three-dimensional space around Earth.

For a selected satellite, the worker derives the orbital period from TLE mean motion and samples one complete orbit centered on the selected simulation time:

```text
startTime = centerTime - period / 2
endTime   = centerTime + period / 2
```

The default sampling density is 240 points per orbit.

Each sample is propagated with SGP4 and converted to geodetic coordinates containing:

```text
[longitude, latitude, altitudeKm]
```

The path is then split at antimeridian crossings before being passed to the globe renderer.

### 3D rendering

The orbit is rendered using a deck.gl `PathLayer` with longitude, latitude, and altitude coordinates. The current globe implementation applies an altitude visualization scale of `300×` when converting the altitude component to the 3D layer coordinate system. This exaggerates orbital height for visual readability and should not be interpreted as the physical scale of the orbit.

- Available in **3D mode**
- 240 samples per orbital period by default
- Antimeridian-aware path segmentation
- 2.5px nominal path width
- 75% layer opacity
- Selected satellite color is reused for the orbit path
- Orbit path is non-pickable and acts as contextual geometry around the selected object

The 3D orbit path is therefore different from the 2D track: the 2D track answers **where the satellite moves over Earth's surface**, while the 3D orbit path answers **what the satellite's orbital trajectory looks like in space**.

## 5. Selection and Layer Lifecycle

Selecting a satellite enables both its temporal track and 3D orbit path by default. Each layer can then be toggled independently for the focused satellite.

The selection controller maintains separate state for:

```text
showTrackById
showOrbitPathById
```

Deselecting a satellite removes both visualization states and associated generated path data.

The application limits the number of simultaneously selected satellites through the shared selection limit. This keeps multi-object path rendering bounded while still allowing comparative orbital analysis.

## 6. Simulation Time

Both selected-satellite visualizations respect DRAKON's simulation offset.

The path center time is calculated as:

```text
centerTime = now + simulationOffsetHours
```

Changing simulation time causes the relevant path request to be regenerated. Request keys include the TLE, simulation offset, and current selected-position key so stale asynchronous results are not applied after the visualization state has changed.

This makes the paths consistent with DRAKON's temporal visualization model rather than treating them as static geometry.

## 7. Propagation and Coordinate Pipeline

The common propagation pipeline is:

```text
TLE line 1 + TLE line 2
        ↓
satellite.js twoline2satrec()
        ↓
SGP4 propagation at requested time(s)
        ↓
ECI position
        ↓
ECI → geodetic conversion
        ↓
longitude / latitude / altitude
        ↓
antimeridian segmentation
        ↓
deck.gl PathLayer
```

For the inclination-band representative track, only longitude and latitude are required because it represents the satellite's ground footprint.

For the 2D selected-satellite track, longitude and latitude plus a temporal opacity parameter are retained.

For the 3D orbit path, altitude is retained and supplied to the globe renderer as the third coordinate.

## 8. Worker Architecture

Path propagation is executed through the Comlink satellite Web Worker rather than on the main UI thread.

The worker exposes separate operations for:

- `generateGroundTrack()`
- `generateSatelliteTrack()`
- `generateSatelliteOrbitPath()`

The application-side `lib/satelliteWorker.ts` wrapper manages the worker connection and normalizes the returned data into the visualization types.

This keeps repeated SGP4 propagation for path generation away from the rendering thread, which is important when the globe is already rendering thousands of satellite points.

## 9. Caching and Request Consistency

The representative inclination-band track uses an in-memory cache keyed by the selected inclination and tolerance. The cache is bounded and cleared when it grows beyond the configured size.

Selected-satellite paths use request keys and per-satellite request sequence numbers. A completed worker request is accepted only when its request key and sequence still match the latest request for that satellite.

This prevents an older propagation result from overwriting a newer result after a selection, TLE, position, or simulation-time change.

The worker wrapper also keeps the general worker communication asynchronous and provides graceful failure handling when path generation cannot be completed.

## 10. Debouncing and Recalculation

Inclination and tolerance controls are debounced by 300 ms before band membership and representative-track generation are updated. This prevents continuous worker requests while a slider is being dragged.

Selected-satellite track and orbit-path generation is request-driven rather than continuously recomputed every render. A new path is requested when the selected object, enabled state, TLE, relevant position state, or simulation offset changes.

## 11. Visualization Semantics

The three path types should not be interpreted as the same data product:

| Visualization | Time span | Coordinates | Purpose |
| --- | --- | --- | --- |
| Inclination-band track | One representative orbit | Lon/lat | Show orbital-shell geographic footprint |
| Selected satellite track | One period past + one period future | Lon/lat + temporal opacity | Show recent and propagated ground motion |
| Selected satellite orbit path | One orbit centered on simulation time | Lon/lat/altitude | Show the 3D orbital trajectory |

The distinction is important because a ground track is a projection of orbital motion onto Earth's surface, while the 3D orbit path retains altitude and therefore represents the spacecraft trajectory around Earth more directly.

## 12. Performance Characteristics

The computational cost is dominated by SGP4 propagation and the number of path samples.

Current defaults are:

- Inclination-band representative track: 240 samples
- Selected 2D track: 120 past + 120 future samples
- Selected 3D orbit path: 240 samples

The paths are generated only for selected objects rather than for the full satellite catalog. This keeps the visualization scalable while allowing detailed trajectory inspection on demand.

The underlying satellite layer can continue rendering the broader catalog independently of these path calculations.

## 13. Limitations

1. **TLE-dependent accuracy:** All paths inherit the age and accuracy limitations of the source TLE.
2. **SGP4 model:** Propagation uses SGP4 and does not model arbitrary future maneuvers, station-keeping commands, or conjunction avoidance maneuvers.
3. **Temporal interpretation:** The future 2D track is a propagated trajectory from the current TLE, not a guaranteed future ground track.
4. **Representative band track:** One satellite represents the selected inclination band, so differences in RAAN, eccentricity, altitude, and mean motion among band members are intentionally not shown in the band footprint.
5. **3D altitude exaggeration:** The 300× altitude scale is a visualization transformation for readability, not physical scale.
6. **Antimeridian segmentation:** Paths are split when longitude changes by more than 180° to prevent incorrect lines across the globe.
7. **No uncertainty envelope:** The current path visualization does not render positional covariance or confidence bounds.

## 14. Future Extensions

- Multiple simultaneous inclination bands
- Comparative orbital-plane analysis
- Historical inclination and orbital-shell evolution
- Uncertainty/covariance visualization
- Maneuver-aware trajectory prediction
- Higher-fidelity propagation modes for selected objects
- Exportable orbit and ground-track data

## Related

- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Re-Entry Risk Screening](./REENTRY_RISK.md)
- [TLE Pipeline Architecture](./TLE_PIPELINE_ARCHITECTURE.md)
