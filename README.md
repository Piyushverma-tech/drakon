# DRAKON-01A (in development)

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
│ │ ├─ layout.tsx
│ │ └─ components/
│ ├─ api/ # Serverless endpoints
│ └─ globals.css
├─ components/ # Shared UI components
├─ lib/ # Helpers (satellite.js, API client)
├─ worker/ # Background jobs
│ ├─ index.ts
│ ├─ jobs/
│ └─ queue.ts
├─ scripts/ # TLE fetchers and automation
├─ db/ # Migrations and schema
├─ package.json
├─ docker-compose.yml
└─ Dockerfile
```

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

- **Interactive 3D globe with real-time satellite visualization** ✅
- **Fleet overview with LEO/MEO/GEO/Debris classification** ✅
- **Satellite details panel** ✅
- **Collision screening workflow prototype** ✅
- **Search and filtering** ✅
- **Orbital Plane Visualization (Inclination Bands)** ✅
- **Alerts panel and WebSocket-based updates** 🔄

### Orbital Plane Visualization (Inclination Bands)

**Feature Overview:**
The inclination band visualization allows users to visualize orbital planes and identify satellites that share similar orbital inclinations. This is particularly useful for analyzing satellite constellations (e.g., Starlink at ~53°), identifying orbital shells, and understanding spatial distribution patterns.

**Implementation Details:**

- **Ground Track Rendering:** Uses deck.gl `PathLayer` to render orbital ground tracks as cyan arcs on the globe. The ground track is generated by sampling a representative satellite's orbit over one complete period (240 points for smooth visualization while maintaining performance).

- **Interactive Controls:**
  - **Inclination Slider:** Adjust the target inclination angle (0-120°) to focus on specific orbital planes
  - **Tolerance Control:** Adjustable ± degrees (0.5-10°) to control band width
    - Smaller tolerance = cleaner visualization with fewer matches (more precise)
    - Larger tolerance = more satellites included (broader analysis)
  - **Toggle Switch:** Enable/disable band visualization and highlighting

- **Satellite Highlighting:** Satellites within the selected inclination band are automatically highlighted with brighter cyan colors and slightly increased radius, making them easy to identify on the globe.

- **Band Statistics:** Real-time display of:
  - Number of satellites in the current band
  - Average altitude of band satellites
  - Current inclination ± tolerance range

**Performance Optimizations:**

- **Worker-Based Ground Track Generation:** Ground track path generation (240 position calculations per orbit) is offloaded to a Web Worker (`generateGroundTrackAsync`) to prevent UI blocking. The worker batches all position calculations and returns the complete path array.

- **Debounced Slider Inputs:** Both inclination and tolerance sliders use 300ms debouncing to prevent expensive recalculations during drag operations. The UI remains responsive while heavy computations are deferred until the user stops adjusting.

- **Intelligent Caching:** Ground tracks are cached per `(inclination, tolerance)` key combination. Revisiting the same band settings instantly displays the cached track without recalculation.

- **Optimized Band Membership Computation:** Uses `Map`-based lookups (O(1)) for satellite ID matching and only recalculates when debounced values change.

**Technical Stack:**
- Worker implementation: `lib/workers/satellite.worker.ts` (Comlink-based)
- Async wrapper with caching: `lib/satelliteWorker.ts`
- UI component: `components/SatelliteGlobe.tsx`
- Visualization: deck.gl `PathLayer` + `ScatterplotLayer`

### Performance / Heavy-Compute Offload

**Completed Optimizations:**

- Dedicated web worker for orbit propagation implemented: `lib/workers/satellite.worker.ts` ✅
- Comlink wrapper + caching and graceful fallbacks added: `lib/satelliteWorker.ts` ✅
- Batch propagation API (worker) and async wrappers added and used from the UI (bulk propagation, focus-by-satellite): `batchPositionFromTLEAsync`, `positionFromTLEAsync` ✅
- Moved/added async worker-backed helpers in `lib/fleet-health.ts` (e.g., `assessSatelliteHealthAsync`, `generateMockTelemetryAsync`) ✅
- **Ground track generation moved to worker:** `generateGroundTrackAsync` batches 240 position calculations in worker thread ✅
- **Slider debouncing:** 300ms debounce on inclination and tolerance controls to prevent excessive recalculations ✅
- Small generic Blob-worker helper (`lib/runInWorker.ts`) retained for pure JS functions and simple offloads ✅
- Components updated to use async worker APIs with synchronous fallback: `components/SatelliteGlobe.tsx`, `components/FleetHealth.tsx` ✅

**Notes:**

- Migration status: Core propagation, fleet-health, and ground track generation are migrated to use workers. Other heavy computations (conjunction screening, large collision search loops) remain to be moved — still in progress.
- Caching: In-memory cache (Map) implemented for worker results. Considering LRU/TTL or IndexedDB for persistence across reloads.
- Transferables: For very large batches, we will use Transferable ArrayBuffers to avoid deep clones.
- UI Responsiveness: All heavy computations (position propagation, ground track generation) now run in background workers, ensuring smooth 60fps UI interactions even with thousands of satellites.

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
