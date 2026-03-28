# DRAKON (in development)

### Space Object Tracking & Collision Avoidance Platform

**DRAKON** is an interactive satellite operations dashboard that visualizes real-time orbital objects, predicts potential conjunctions, and monitors fleet health.  
The platform combines satellite telemetry, orbit propagation, and predictive analytics to enhance situational awareness and operational safety.

---

## Overview

DRAKON integrates real-time orbit computation, conjunction analysis, and fleet visualization into a unified interface for satellite operators, researchers, and mission analysts.

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

| Layer                 | Technologies                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| **Frontend**          | Next.js (App Router), React, Tailwind CSS, shadcn/ui                        |
| **3D Visualization**  | deck.gl + Mapbox _(alternatives: CesiumJS, three.js)_                       |
| **Charts**            | Recharts / Chart.js / ApexCharts                                            |
| **Orbit Propagation** | satellite.js (SGP4)                                                         |
| **Backend / Jobs**    | Next.js API routes, Node.js worker (BullMQ + Redis)                         |
| **Database**          | PostgreSQL + PostGIS                                                        |
| **Realtime**          | Socket.IO / Pusher / Supabase Realtime                                      |
| **Queue / Cache**     | Redis                                                                       |
| **Authentication**    | Clerk / NextAuth (optional)                                                 |
| **CI/CD**             | GitHub Actions → Vercel (frontend), Render / Fly.io / DigitalOcean (worker) |
| **Monitoring**        | Sentry, Grafana, Prometheus                                                 |

---

## Project Structure

```bash
drakon/
├─ app/
│ ├─ dashboard/
│ │ ├─ page.tsx
│ │ └─ layout.tsx
│ ├─ globe/
│ │ └─ page.tsx
│ ├─ api/                    # Serverless API endpoints
│ │ └─ tle/                # TLE data proxy (Celestrak)
│ ├─ layout.tsx              # Root layout with Redux Provider
│ └─ globals.css
├─ components/                # React UI components
│ ├─ SatelliteGlobe.tsx      # Main 3D globe visualization
│ ├─ Globe.tsx                # Deck.gl globe wrapper
│ ├─ FleetHealth.tsx         # Fleet health dashboard
│ └─ layout/                 # Layout components
│   ├─ Sidebar.tsx
│   └─ Topbar.tsx
├─ hooks/                    # Custom React hooks
│ ├─ useSatellitePositions.ts    # Satellite position updates
│ ├─ useInclinationBands.ts      # Inclination band logic
│ └─ useCollisionDensity.ts     # Collision density computation
│ └─ useSimulatedPositions.ts     # replaces useSatellitePositions when simulating
├─ lib/                      # Core libraries and utilities
│ ├─ store.ts                # Redux store configuration
│ ├─ tle-slice.ts            # Redux slice for TLE data
│ ├─ visualization-slice.ts   # Redux slice for visualization state
│ ├─ satellite.ts            # Satellite.js sync helpers
│ ├─ satelliteWorker.ts      # Worker async wrappers with caching
│ ├─ satelliteHelpers.ts     # TLE parsing, orbit classification
│ ├─ fleet-health.ts         # Fleet health assessment
│ ├─ providers.tsx            # Redux Provider wrapper
│ ├─ utils.ts                # General utilities
│ └─ workers/                # Web Worker implementations
│   └─ satellite.worker.ts   # Comlink-based worker (SGP4, density)
├─ docs/                     # Documentation
│ ├─ ORBITAL_PLANE_VISUALIZATION.md
│ └─ COLLISION_DENSITY_MAP.md
├─ public/                   # Static assets
├─ package.json
├─ tsconfig.json
└─ README.md
```

### Key Directories

- **`app/`**: Next.js App Router pages and API routes
  - `globe/`: Main 3D visualization page
  - `api/tle/`: TLE data proxy endpoint
- **`components/`**: React UI components
  - `SatelliteGlobe.tsx`: Main visualization component with deck.gl layers
- **`hooks/`**: Custom React hooks for business logic
  - Encapsulates satellite position updates, band calculations, and density analysis
- **`lib/`**: Core libraries and utilities
  - `store.ts`: Redux store with TLE and visualization slices
  - `workers/`: Web Worker implementations for heavy computations
  - Helper functions for TLE parsing, orbit classification, and satellite calculations
- **`docs/`**: Feature documentation
  - Detailed implementation guides for advanced visualization features

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

| Method | Endpoint                       | Description                                 |
| ------ | ------------------------------ | ------------------------------------------- |
| `GET`  | `/api/satellites`              | List all tracked satellites                 |
| `GET`  | `/api/satellites/:id/position` | Get position of a satellite at a given time |
| `GET`  | `/api/positions?since=...`     | Stream recent positions                     |
| `GET`  | `/api/conjunctions?range=24h`  | Get conjunctions within a given time window |
| `POST` | `/api/run-screening`           | Trigger a collision screening job           |
| `GET`  | `/api/alerts`                  | Retrieve critical alerts                    |

---

## Data Flow

1. Worker periodically fetches TLEs and stores them in the database.
2. Worker propagates orbits using `satellite.js` and computes live positions.
3. Screening jobs identify close approaches and insert alerts into Redis/DB.
4. Frontend subscribes via WebSockets or polling to update the 3D globe and panels.
5. User-triggered screening initiates async jobs with returned results upon completion.

---

## Current Status

### Core Features ✅

- **Interactive 3D Globe**: Real-time visualization of satellites using TLEs and `satellite.js` with deck.gl
- **Fleet Overview**: LEO/MEO/GEO/Debris classification with interactive filtering
- **Satellite Details Panel**: Comprehensive display of NORAD ID, position, velocity, inclination, orbit type, and TLE epoch
- **Search and Filtering**: Real-time search by satellite name or NORAD ID with result highlighting
- **State Management**: Migrated to Redux Toolkit for centralized TLE data and search state management

### Advanced Visualization Features ✅

#### Orbital Plane Visualization (Inclination Bands)

A powerful tool for analyzing satellite constellations and orbital shells. Features include:

- **Ground Track Rendering**: Cyan-colored orbital paths rendered using deck.gl `PathLayer`
- **Interactive Controls**:
  - Inclination slider (0-120°) for targeting specific orbital planes
  - Tolerance control (±0.5-10°) for adjusting band width
  - Toggle switch for enabling/disabling visualization
- **Satellite Highlighting**: Automatic highlighting of satellites within the selected band with enhanced visibility
- **Real-time Statistics**: Band membership count, average altitude, and current range display
- **Performance Optimized**: Worker-based ground track generation, debounced inputs (300ms), and intelligent caching

📖 **Full Documentation**: See [docs/ORBITAL_PLANE_VISUALIZATION.md](./docs/ORBITAL_PLANE_VISUALIZATION.md)

#### Collision Density Map

Real-time spatial analysis for identifying crowded orbital regions and potential close approaches:

- **Density Visualization**: All satellites colored by local collision density (blue = safe, purple = high risk)
- **Close Approach Detection**: Voxel-based algorithm identifies satellite pairs within configurable detection radius
- **Visual Indicators**:
  - Density-based satellite coloring with 5-zone gradient
  - Line visualization for candidate close-approach pairs
  - Color-coded risk levels (red/pink for high risk, amber for moderate)
- **Interactive Controls**:
  - Detection radius slider (10-250 km) for adjusting analysis scope
  - Toggle switch for enabling/disabling density analysis
  - Color legend showing density gradient
- **Statistics Panel**: Hotspot counts, top close approaches list, peak density metrics
- **Performance Optimized**: Worker-based computation, 500ms debouncing, efficient voxel grid algorithm

📖 **Full Documentation**: See [docs/COLLISION_DENSITY_MAP.md](./docs/COLLISION_DENSITY_MAP.md)

### Performance Optimizations ✅

**Worker-Based Computation:**

- Dedicated web worker for orbit propagation: `lib/workers/satellite.worker.ts` (Comlink-based)
- Async wrappers with caching: `lib/satelliteWorker.ts`
- Batch propagation APIs: `batchPositionFromTLEAsync`, `positionFromTLEAsync`
- Ground track generation: `generateGroundTrackAsync` (240 position calculations per orbit)
- Collision density computation: `computeCollisionDensityAsync` (voxel-based spatial analysis)

**UI Responsiveness:**

- Debounced slider inputs (300ms for inclination bands, 500ms for density map)
- Intelligent caching for worker results (in-memory Map-based)
- Optimized data structures (Map-based lookups, O(1) operations)
- Smooth 60fps UI interactions even with thousands of satellites

**Migration Status:**

- ✅ Core orbit propagation
- ✅ Fleet health assessment
- ✅ Ground track generation
- ✅ Collision density computation
- ✅ Predictive time simulation
- 🔄 Conjunction screening (in progress)
- 🔄 Large collision search loops (in progress)

**Future Enhancements:**

- LRU/TTL cache or IndexedDB for persistence across reloads
- Transferable ArrayBuffers for very large batches
- Predictive density analysis with time projection

### In Progress 🔄

- **Alerts Panel**: WebSocket-based real-time updates for collision warnings
- **Conjunction Screening**: Advanced collision prediction algorithms
- **Historical Analysis**: Time-based tracking of density and close approaches

---

## Development Setup

```bash
# Create project
npx create-next-app@latest drakon-dashboard --experimental-app
cd drakon-dashboard

# Install dependencies
npm install tailwindcss @tailwindcss/forms satellite.js redis bullmq socket.io-client socket.io

# Run frontend
npm run dev

# Run worker (separate terminal)
NODE_ENV=development node worker/index.js

```

---

**License**

MIT License © 2025 DRAKON Project
