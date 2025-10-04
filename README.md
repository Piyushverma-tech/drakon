DRAKON-01A – Space Object Tracking & Collision Avoidance Platform

An interactive satellite operations dashboard that visualizes real-time orbital objects, predicts potential conjunctions, and provides fleet health monitoring.

🔭 High-Level Roadmap

MVP (Current Progress ✅):

🌍 Interactive 3D globe with real-time satellite positions (using TLEs + satellite.js)

📊 Fleet Health card with orbit breakdown (LEO / MEO / GEO / Debris)

📈 Proximity Timeline (next 24h)

🚨 Critical Alerts list

📉 Historical Trends chart (basic)

▶️ “Run Collision Screening” action

Next Features (Planned 🔜):

Conjunction prediction engine (optimized, spatial indexing)

Maneuver planner + cost modeling

Advanced UI/UX polish

Multi-tenant support

Improved caching + geospatial queries (PostGIS)

🛠️ Tech Stack

Frontend: Next.js (App Router) · React · Tailwind CSS · shadcn/ui
3D Globe: deck.gl + Mapbox (alt: CesiumJS, three.js)
Charts: Recharts / Chart.js / ApexCharts
Orbit propagation: satellite.js
(SGP4)
Backend / Jobs: Next.js API routes, Node.js worker (BullMQ + Redis)
Database: PostgreSQL + PostGIS (later)
Realtime: WebSockets (Socket.IO) or managed service (Pusher / Supabase Realtime)
Queue / Cache: Redis
Auth: Clerk / NextAuth (optional)
CI/CD: GitHub Actions → Vercel (frontend), Render/Fly.io/DigitalOcean (worker/ws)
Monitoring: Sentry, Grafana, Prometheus

📂 Project Structure
/drakon
├─ /app
│ ├─ /dashboard
│ │ ├─ page.tsx
│ │ ├─ layout.tsx
│ │ └─ components/
│ ├─ /api # serverless endpoints
│ └─ globals.css
├─ /components # shared UI components
├─ /lib # helpers (satellite.js, API client)
├─ /worker # background jobs
│ ├─ index.ts
│ ├─ jobs/
│ └─ queue.ts
├─ /scripts # fetch TLE scripts
├─ /db # migrations
├─ package.json
├─ docker-compose.yml
└─ Dockerfile

Data Model (Postgres)

satellites → core satellite info (name, NORAD ID, TLEs, owner)

tle_history → historical TLEs per sat

positions → computed positions over time

conjunctions → close approaches (time, distance, risk)

maneuvers → planned burns (Δv, ETA, fuel est.)

alerts → critical events + collision warnings

🌐 API Endpoints (MVP)

GET /api/satellites → list satellites

GET /api/satellites/:id/position → get satellite position at given time

GET /api/positions?since=... → stream recent positions

GET /api/conjunctions?range=24h → conjunctions in time window

POST /api/run-screening → enqueue screening job

GET /api/alerts → list critical alerts

🔄 Data Flow

Worker fetches TLEs periodically → stores in DB

Worker propagates orbits using satellite.js → computes live positions

Screening job checks for close approaches → inserts alerts into DB/Redis

Frontend subscribes via WebSocket / polling → updates globe + panels

User triggers “Run Collision Screening” → async job → results returned

⚡ Development
Setup

# create project

npx create-next-app@latest drakon-dashboard --experimental-app
cd drakon-dashboard

# install deps

npm install tailwindcss @tailwindcss/forms satellite.js redis bullmq socket.io-client socket.io

Run

# Next.js frontend

npm run dev

# Worker (separate terminal)

NODE_ENV=development node worker/index.js

Docker (optional)
docker-compose up --build

📈 Current Status

✅ Interactive 3D globe with live satellites
✅ Objects overview panel with LEO/MEO/GEO/Debris breakdown
✅ Satellite details panel (with NORAD, velocity, inclination, orbit, etc.)
✅ Loading state until API data is ready
🔜 Search & filtering (in progress)

📌 Roadmap

Satellite globe visualization

Object overview + detail panel

Search & filter satellites

Alerts + Proximity Timeline

Historical Trends chart

Collision screening worker

Real-time WebSocket updates

📜 License

MIT License © 2025 DRAKON
