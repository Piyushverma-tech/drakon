# DRAKON (in development)

### Space Object Tracking & Collision Avoidance Platform

**DRAKON** is an interactive satellite operations dashboard that visualizes real-time orbital objects, predicts potential conjunctions, and monitors fleet health.  
The platform combines satellite telemetry, orbit propagation, and predictive analytics to enhance situational awareness and operational safety.

---

## Overview

DRAKON integrates real-time orbit computation, conjunction analysis, and fleet visualization into a unified interface for satellite operators, researchers, and mission analysts.

---

## 📸 Screenshots / Demo

<div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
    <img src="public/Demo/GlobeView.png" alt="3D Globe View" width="45%">
    <img src="public/Demo/OrbitalPlane.png" alt="Orbital Plane Rendering" width="45%">
    <img src="public/Demo/Collision_Density.png" alt="Collision Density Screening" width="45%">
    <img src="public/Demo/Re-Entry_Screening.png" alt="Re-Entry Risk Screening" width="45%">
</div>

---

## Current MVP Features

- **Interactive 3D Globe:** Real-time visualization of satellites using TLEs and `satellite.js`.
- **Fleet Health Overview:** Orbit breakdown (LEO / MEO / GEO / Debris).
- **Satellite Details Panel:** Display NORAD ID, velocity, inclination, orbit type, and related data.
- **Proximity Timeline:** Visualize potential close approaches over the next 24 hours.
- **Critical Alerts:** List of high-risk conjunctions and anomalies.
- **Historical Trends:** Basic analytics on orbit and event data.
- **Collision Screening:** Trigger on-demand screening jobs for conjunction checks.

---

## Planned Features

- Optimized conjunction prediction engine with spatial indexing.
- Maneuver planner and Δv cost modeling.
- Multi-tenant organization support.
- Enhanced caching and geospatial queries (PostGIS).
- UI/UX improvements and advanced visual analytics.
- Real-time updates with WebSockets or managed services.
- System monitoring using Grafana and Prometheus.

---

## Tech Stack

| Layer                 | Technologies                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Frontend**          | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui                        |
| **3D Visualization**  | deck.gl (GlobeView) + BitmapLayer day/night Earth texture                                     |
| **Charts**            | Recharts                                                                                      |
| **Orbit Propagation** | satellite.js (SGP4), Comlink Web Workers                                                      |
| **State Management**  | Redux Toolkit (visualization state) + TanStack Query v5 (TLE data fetching)                   |
| **Backend / API**     | Next.js API Routes (serverless)                                                               |
| **Cache**             | Upstash Redis (HTTP-based, serverless-compatible) — 2h TTL + permanent stale fallback         |
| **TLE Source**        | Celestrak NORAD GP catalog (active, iridium-33-debris, cosmos-2251-debris, fengyun-1c-debris) |
| **CI/CD**             | GitHub Actions → Vercel                                                                       |

---

## Project Structure

```bash
drakon/
├─ app/
│  ├─ api/
│  │  ├─ socket/                # Reserved for realtime socket route(s)
│  │  └─ tle/
│  │     └─ route.ts            # TLE proxy: Celestrak → Upstash Redis → client
│  ├─ dashboard/
│  │  ├─ components/
│  │  │  ├─ layout/
│  │  │  │  ├─ Sidebar.tsx      # Dashboard sidebar navigation
│  │  │  │  └─ Topbar.tsx       # Dashboard header
│  │  │  └─ UnderDevelopment.tsx
│  │  ├─ layout.tsx             # Sidebar + Topbar layout
│  │  └─ page.tsx               # Dashboard entry page
│  ├─ globe/
│  │  ├─ GlobeContent/
│  │  │  ├─ components/
│  │  │  │  ├─ panels/
│  │  │  │  │  ├─ LeftPanel.tsx
│  │  │  │  │  └─ RightPanel.tsx
│  │  │  │  ├─ DensityLegend.tsx
│  │  │  │  ├─ ForeCastOverlay.tsx
│  │  │  │  └─ MobileViewNotice.tsx
│  │  │  ├─ Globe3D.tsx         # deck.gl 3D globe renderer + layers
│  │  │  ├─ GlobeContainer.tsx  # Main globe composition and state wiring
│  │  │  └─ Map2d.tsx           # 2D map renderer
│  │  └─ page.tsx
│  ├─ [...slug]/
│  │  └─ page.tsx
│  ├─ globals.css
│  ├─ layout.tsx                # Root layout with providers
│  └─ page.tsx
├─ hooks/
│  ├─ useTleEntriesQuery.ts     # TanStack Query hook — fetches + parses TLE text
│  ├─ useSatellitePositions.ts  # Live SGP4 positions, 5s interval
│  ├─ useSimulatedPositions.ts  # Projected positions at T+offset (600ms debounce)
│  ├─ useSelectedSatelliteTrack.ts  # Past + future ground track for selected sat
│  ├─ useInclinationBands.ts    # Orbital plane band membership + ground track
│  ├─ useCollisionDensity.ts    # Voxel-based 3D density computation
│  └─ useSatelliteMetadata.ts   # Loads precomputed satellite metadata
├─ lib/
│  ├─ store.ts                  # Redux store (visualization slice only)
│  ├─ visualization-slice.ts    # Filters, bands, density, simulation, re-entry flags
│  ├─ satellite.ts              # Synchronous SGP4 helpers (positionFromTLE etc.)
│  ├─ satelliteWorker.ts        # Comlink async wrappers + in-memory cache (CACHE_MAX=1000)
│  ├─ satelliteHelpers.ts       # parseBSTAR, parseMeanMotionDot, getReentryRisk, parseTLEMeta
│  ├─ satelliteHelpers.test.ts  # Unit tests for helper/parsing functions
│  ├─ redis.ts                  # Upstash Redis client singleton
│  ├─ providers.tsx             # Redux + TanStack QueryClient providers
│  ├─ types.ts                  # TleEntry, SatellitePoint, ReentryRisk, metadata types
│  ├─ utils.ts
│  └─ workers/
│     └─ satellite.worker.ts    # Comlink worker: SGP4, density, ground tracks
├─ docs/
│  ├─ ORBITAL_PLANE_VISUALIZATION.md
│  ├─ COLLISION_DENSITY_MAP.md
│  └─ REENTRY_RISK.md
├─ scripts/
│  └─ build-satellite-metadata.ts  # Metadata build/precompute script
├─ public/
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## Data & Caching Architecture

### TLE Pipeline

```
Celestrak NORAD GP API
  └─ /api/tle (Next.js route)
       ├─ Step 1: Upstash Redis GET tle:combined  → HIT: return cached (x-cache: HIT)
       ├─ Step 2: Fetch all 4 groups from Celestrak with content validation
       │    └─ Guards: HTTP status + "Invalid query" text + TLE line format check
       ├─ Step 3: Redis SET tle:combined (TTL 2h) + tle:combined:stale (no TTL)
       └─ Step 4: If Celestrak empty → serve tle:combined:stale (x-cache: STALE)
```

**Key design decisions:**

- Single combined `/api/tle` call from client — no per-group requests
- `tle:combined:stale` has no TTL intentionally — it's an emergency fallback, overwritten every successful fetch
- Content validation rejects Celestrak's 200-with-error-body responses (e.g. discontinued `1999-025` group)
- 1.1s delay between group fetches to respect Celestrak rate limits

### TLE Groups

| Group                | Contents                                          |
| -------------------- | ------------------------------------------------- |
| `active`             | ~15000 operational satellites                     |
| `iridium-33-debris`  | ~700 fragments from 2009 Iridium/Cosmos collision |
| `cosmos-2251-debris` | ~1500 fragments from 2009 collision               |
| `fengyun-1c-debris`  | ~3000 fragments from 2007 Chinese ASAT test       |

> `1999-025` (Fengyun-1C debris alternate group) was removed — Celestrak discontinued it and returned HTTP 200 with an error string, which poisoned the cache and misaligned the TLE parser for all subsequent groups.

### Client-Side Caching (TanStack Query)

```typescript
staleTime: 2 * 60 * 60 * 1000,  // matches Redis TTL — no redundant refetches
gcTime:    4 * 60 * 60 * 1000,
refetchOnWindowFocus: false,
```

---

## State Management

Two separate systems handle different concerns:

**Redux Toolkit** (`lib/visualization-slice.ts`) — ephemeral UI state that doesn't need to persist or be shared across sessions: active filters, simulation offset, selected satellite ID, band/density/re-entry toggle flags.

**TanStack Query** (`hooks/useTleEntriesQuery.ts`) — server data with lifecycle management: TLE fetching, caching, background revalidation, deduplication across components. Replaced the previous `tle-slice.ts` Redux slice.

---

## Current Status

### Core Features ✅

- **Interactive 3D Globe**: Real-time visualization of satellites using TLEs and `satellite.js` with deck.gl GlobeView
- **Day/Night Earth Texture**: BitmapLayer blending `earth_day.jpg` / `earth_night.jpg` based on SunCalc sub-solar position, redrawn every 30s with `drawTick` state trigger
- **Fleet Overview**: LEO/MEO/GEO/Debris classification with interactive filtering
- **Satellite Details Panel**: NORAD ID, position, velocity, inclination, orbit type, TLE epoch, re-entry risk
- **Search**: Real-time search by satellite name or NORAD ID with globe fly-to on selection

### Advanced Visualization Features ✅

#### Orbital Plane Visualization (Inclination Bands)

- Ground track rendering via deck.gl `PathLayer`
- Inclination slider (0–120°) + tolerance control (±0.5–10°)
- Satellite highlighting within band, dimming of everything else
- Real-time band membership count + average altitude
- Worker-backed track generation, 300ms debounced inputs, `Map`-keyed track cache

📖 See [docs/ORBITAL_PLANE_VISUALIZATION.md](./docs/ORBITAL_PLANE_VISUALIZATION.md)

#### Collision Density Map

- Voxel-grid O(N·26) spatial index replacing O(N²) brute force
- 3D ECEF coordinates, 26-neighbor voxel search
- Per-satellite density normalization via `satelliteDensities` map (O(1) lookup)
- Candidate pair filtering: same-launch ID proximity, same-operator separation, relative velocity check via SGP4
- Line layer for close-approach pairs, color-coded by distance threshold
- 500ms debounced computation, detection radius slider (10–250 km)

📖 See [docs/COLLISION_DENSITY_MAP.md](./docs/COLLISION_DENSITY_MAP.md)

#### Re-Entry Risk Screening ✅

Physics-based screening using BSTAR drag term from TLE Line 1. TLE parsing also stores `meanMotionDot` (Ṅ) for secondary decay validation.

**Object filter:** Only objects classified as debris are screened. Rocket bodies are included by the TLE parser (`R/B`, `ROCKET`, `RKT` set `isDebris = true`). Active propulsive satellites are excluded — their BSTAR values are corrupted by maneuvers.

**Decay model:**

```
decayRate (km/day) = |BSTAR| × 7.4e3 × exp((400 - altKm) / 60) × (v / 7.905)
estimatedDays      = ceil(((perigeeKm - 120) / decayRate) × 2/3)
```

**Risk tiers:**

| Tier     | Threshold                                  | Globe color |
| -------- | ------------------------------------------ | ----------- |
| Critical | < 30 days                                  | Red-orange  |
| Warning  | Above critical, below altitude-aware limit | Amber       |
| Nominal  | Above warning, below altitude-aware limit  | Yellow      |
| Stable   | Beyond limit or excluded                   | Dimmed      |

Critical stays fixed at 30 days. Warning/nominal limits compress at high altitude to reduce long-horizon false positives from noisy single-epoch drag terms. Positive `meanMotionDot` agreement raises confidence, but does not change the risk tier thresholds.

**Sanity gates:** `perigeeKm > 2000` or `periodMin > 600` → stable; negligible computed decay → stable; altitude-aware decay-rate anomaly guard → stable. The old flat `decayRate > 20 km/day` guard is replaced with a density-scaled cap above 180 km and disabled during terminal low-altitude decay.

📖 See [docs/REENTRY_RISK.md](./docs/REENTRY_RISK.md)

#### Satellite Ground Track ✅

- Past track (teal, fading) + future track (blue, fading) as `PathLayer` segments
- `generateSatelliteTrack` in worker: 120 samples past + 120 future across 1 orbital period
- `splitAtAntimeridian` prevents horizontal slash lines at ±180° longitude
- Opacity encoded as normalizedT in `[lon, lat, t]` tuples, converted to per-segment `TrackSegment`
- `requestIdRef` pattern prevents stale async results when satellite changes mid-flight
- Reruns on `simulationOffsetHours` change

#### Predictive Time Simulation ✅

- Redux: `simulationOffsetHours`, `isSimulating`, `simLoading`
- `useSimulatedPositions` hook: 600ms debounce on initial compute, 10s periodic refresh
- `batchPositionAtOffsetAsync`: stamps all entries with `Date.now() + offsetMs`
- ForecastOverlay: IBM Plex Mono, 72h window, drag scrubber, amber warning beyond 48h (SGP4 accuracy degrades)
- `simLoading` in Redux so ForecastOverlay subscribes independently without prop drilling

### Performance Optimizations ✅

**Worker architecture:**

- Single persistent Comlink worker (`satellite.worker.ts`) — no per-call worker spawn overhead
- In-memory LRU-style cache in `satelliteWorker.ts` (`CACHE_MAX=1000`, FIFO eviction)
- `batchPositionFromTLE` sends entire array in one Comlink call, not per-satellite messages

**React rendering:**

- `filteredSatellites`, `reentryRisks`, `densityLayers`, `trackLayers`, `layers` all `useMemo`
- `RightPanel` and `LeftPanel` wrapped in `memo` with custom prop comparators
- `reentryRisksRef` pattern: ref updated by `useEffect`, read inside `getFillColor` closure — avoids adding `reentryRisks` Map to `layers` useMemo deps (prevents 5s recompute freeze)
- `focusSatellite` wrapped in `useCallback([simulationOffsetHours])` — fixes stale closure bug when simulation is active, and included in RightPanel memo comparator

**isDebris classification** (in `useTleEntriesQuery.ts`):

```typescript
const isDebris =
  lowerName.includes('deb') || // DEB, DEBRIS
  lowerName.includes('r/b') || // rocket bodies
  lowerName.includes('rkt') || // older catalog names
  lowerName.includes('rocket') ||
  lowerName.includes('platform'); // defunct platforms
```

Used for globe coloring (gray dots) and as a gate in `getReentryRisk` for re-entry screening.

### In Progress 🔄

- **Alerts Panel**: WebSocket-based real-time updates for collision warnings
- **Conjunction Screening**: Advanced collision prediction algorithms
- **Historical Analysis**: Time-based tracking of density and close approaches

---

## Pending / Backlog Features

- **Conjunction timeline**: Sweep T+0→T+72h, chart pair counts over time
- **Hohmann transfer maneuver planner**: Δv calculator for orbit transfers
- **Multi-epoch BSTAR trending**: `tle_history` PostgreSQL table for BSTAR drift analysis
- **Solar activity (F10.7 flux) correction**: Improve re-entry estimates during solar maximum
- **Re-entry footprint corridor**: Show ground track corridor on globe for objects within 7 days
- **Space-Track CDM integration**: Conjunction Data Messages (requires account + backend job)
- **PostgreSQL tle_history inserts**: Fire-and-forget alongside Redis cache writes
- **Stale data timestamp header**: `x-stale-since` response header + frontend freshness warning banner

---

## Database Schema (PostgreSQL)

| Table            | Description                                       |
| ---------------- | ------------------------------------------------- |
| **satellites**   | Core satellite data (name, NORAD ID, TLEs, owner) |
| **tle_history**  | Historical TLE records for satellites             |
| **positions**    | Computed positions over time                      |
| **conjunctions** | Close approaches (time, distance, risk)           |
| **maneuvers**    | Planned burns (Δv, ETA, fuel estimate)            |
| **alerts**       | Collision warnings and critical events            |

---

## API Endpoints (MVP)

| Method | Endpoint                       | Description                                          |
| ------ | ------------------------------ | ---------------------------------------------------- |
| `GET`  | `/api/tle`                     | Combined TLE data (all groups). Redis-cached, 2h TTL |
| `GET`  | `/api/satellites`              | List all tracked satellites                          |
| `GET`  | `/api/satellites/:id/position` | Get position of a satellite at a given time          |
| `GET`  | `/api/positions?since=...`     | Stream recent positions                              |
| `GET`  | `/api/conjunctions?range=24h`  | Get conjunctions within a given time window          |
| `POST` | `/api/run-screening`           | Trigger a collision screening job                    |
| `GET`  | `/api/alerts`                  | Retrieve critical alerts                             |

---

## Data Flow

1. `/api/tle` fetches all 4 Celestrak groups server-side with content validation, combines them, and writes to Upstash Redis (`tle:combined` TTL 2h + `tle:combined:stale` permanent).
2. Client calls `/api/tle` once via TanStack Query (`staleTime: 2h`). Parsed into `TleEntry[]` by `parseTleText` in `useTleEntriesQuery`.
3. `useSatellitePositions` propagates all entries via `batchPositionFromTLEAsync` (Comlink worker) every 5 seconds.
4. `useSimulatedPositions` computes projected positions at T+offset when forecast mode is active.
5. deck.gl layers are recomputed via `useMemo` when filtered satellites, mode flags, or selection changes.
6. User-triggered screening (`showDensity`, `showReentry`, `showBands`) activates the relevant hook and recolors the ScatterplotLayer.

---

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-org/drakon
cd drakon
npm install

# Environment variables
cp .env.example .env.local
# Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN

# Run dev server
npm run dev

# Run tests
npm test
npm run test:watch
```

### Environment Variables

| Variable                   | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST endpoint                                        |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token                                           |
| `InDevelopment`            | Set to `"true"` to show UnderDevelopment page for dashboard routes |

---

## Tests

```bash
lib/fleet-health.test.ts      # distanceKm, orbitClassFromAlt, aggregateFleetHealth
lib/satelliteHelpers.test.ts  # formatDistance, classifyOrbit, getOrbitType, parseBSTAR, parseMeanMotionDot
```

Jest configured in `package.json` with `ts-jest`. Worker dependencies are mocked via `jest.mock('./satelliteWorker', ...)`.

---

**License**

MIT License © 2025 DRAKON Project
