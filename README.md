# DRAKON-01A

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

Interactive 3D globe with real-time satellite visualization ✅

Fleet overview with LEO/MEO/GEO/Debris classification ✅

Satellite details panel ✅

Collision screening workflow prototype ✅

Search and filtering ✅

Alerts panel and WebSocket-based updates 🔄

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
