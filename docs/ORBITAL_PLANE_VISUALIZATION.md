# Orbital Plane Visualization (Inclination Bands) — Notes

Visualizes orbital planes / inclination shells to spot constellations (e.g. Starlink ~53°), analyze orbital shells, and see spatial clustering.

## Ground Track Rendering

- deck.gl `PathLayer`, cyan arcs on globe
- Sampled from one representative satellite's orbit over a full period
- 240 points per orbit
- Cyan, 70% opacity, 2px min width

## Controls

1. **Inclination slider**: 0–120°, step 0.5°, default 53° (Starlink shell)
2. **Tolerance**: 0.5–10°, step 0.5°, default 2° — band width around target; smaller = fewer/precise matches, larger = broader
3. **Toggle**: enable/disable band visualization + highlighting

## Highlighting

Satellites within band → brighter cyan `[0,255,255,220]`, larger radius:

- Debris: 30,000m → 40,000m
- Active satellites: 70,000m → 90,000m

## Band Stats (real-time)

- Satellite count matching inclination ± tolerance
- Average altitude of band satellites
- Current range display

## Performance

- Ground track generation (240 position calcs) offloaded to Web Worker (`generateGroundTrackAsync` in `lib/satelliteWorker.ts`) — prevents UI blocking
- 300ms debounce on both sliders — avoids expensive recalc during drag
- Ground tracks cached per `(inclination, tolerance)` key, in-memory Map, rounded cache key
- Band membership uses `Map`-based O(1) lookups, `useMemo`'d, recalculated only on debounced value change

## Key Files

- `lib/workers/satellite.worker.ts` — Comlink worker implementation
- `lib/satelliteWorker.ts` — async wrapper, caching, error handling
- `components/SatelliteGlobe.tsx` — UI
- `generateGroundTrackAsync(entry, samples)`, `getBandSatelliteIds`, `bandTrack` (memoized representative track)

## Data Flow

1. User adjusts inclination/tolerance
2. Debounced values update after 300ms
3. Band membership recalculated (memoized)
4. Representative satellite selected from band
5. Ground track generated or pulled from cache
6. `PathLayer` renders track; `ScatterplotLayer` highlights matching satellites

## Usage Presets

- **Starlink**: incl 53°, tolerance 2°
- **Polar orbit**: incl ~90°, tolerance 5°
- **Sun-synchronous shell**: incl 98°, tolerance 10° (broad)

## Future Ideas

- Multiple simultaneous bands
- Side-by-side band comparison
- Historical band-membership tracking over time
- Export band data / ground tracks
- 3D torus visualization option instead of ground tracks

## Related

- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Re-Entry Risk Screening](./REENTRY_RISK.md)
