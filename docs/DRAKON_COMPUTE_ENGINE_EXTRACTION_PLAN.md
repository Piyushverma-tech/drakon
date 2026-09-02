# DRAKON Compute Engine — Python/FastAPI Extraction & Architecture Plan

**Status:** Proposed architecture  
**Target branch:** `main`  
**Baseline reviewed:** `bf12871c7e712ac5a555bd354c879044406d8336`  
**Scope:** Introduce Python + FastAPI as a dedicated numerical/scientific compute subsystem inside the existing DRAKON repository without destabilizing the existing Next.js application, Redis/PostgreSQL data paths, or cron-driven pipelines.

---

## 1. Executive decision

DRAKON should evolve into a **hybrid application**:

- **Next.js / TypeScript remains the application, orchestration, persistence, provider-integration, and presentation layer.**
- **Python / FastAPI becomes the DRAKON Compute Engine: a dedicated numerical and scientific computation layer for mathematically heavy algorithms, model execution, simulation, calibration, and internal analysis.**
- Both layers remain in the **same Git repository** and share explicit API/data contracts rather than sharing implementation code.
- Existing cron endpoints remain the operational control plane. Python is introduced behind existing boundaries so scheduler cadence, locks, retry behavior, provider logic, and database semantics do not change during the extraction.
- Migration is **incremental and reversible**. Existing TypeScript implementations remain available until Python has passed parity, regression, performance, and production-shadow validation.
- Model versions become first-class metadata. Every scientific result must identify the model family/version and, where applicable, the calibration/parameter-set version.

The objective is **not** to rewrite DRAKON in Python. The objective is to make the mathematical core of DRAKON independently testable, scalable, and scientifically extensible while keeping the existing application stable.

---

## 2. Why this architecture

The current repository already has the correct conceptual seam for this transition: numerical/domain logic is concentrated in `lib/`, while `app/api/` routes and job handlers orchestrate ingestion, persistence, external providers, and application-facing responses.

The current re-entry and trend implementations illustrate why a separate numerical subsystem is justified:

- `lib/satelliteHelpers.ts` contains TLE parsing, orbital-element calculations, BSTAR interpretation, decay-rate estimation, anomaly guards, confidence handling, and re-entry estimation.
- `lib/explainReentryTrend.ts` contains weighted signal analysis, regression-derived signal strengths, confidence aggregation, maneuver likelihood, payload consensus rules, and re-entry estimation logic.
- `lib/jobs/computeObjectTrends.ts` contains the historical regression implementation, rolling windows, recency weighting, and the worker's persistence lifecycle.
- Collision-density and orbital-geometry workloads are naturally aligned with numerical/vectorized computation and can become future Python compute services without requiring the surrounding dashboard architecture to move.

This makes Python useful for reasons stronger than syntax preference:

1. **Numerical clarity:** scientific equations and numerical workflows are generally easier to express and review in Python.
2. **Scientific ecosystem:** NumPy/SciPy and domain-specific libraries can be introduced when they materially improve the model.
3. **Analysis reuse:** the exact production model implementation can be imported by calibration and research scripts rather than duplicated in notebooks.
4. **Performance options:** vectorization, batch processing, multiprocessing, native scientific libraries, and eventually worker processes become available without changing the Next.js UI.
5. **Model governance:** a compute service provides a clean place to define model contracts, versions, validation datasets, parameter sets, and reproducible experiments.

---

## 3. Current architecture baseline

The current application should be treated as the baseline that must continue working during migration.

```text
                         External providers
                    Space-Track / CelesTrak / NOAA
                                  |
                                  v
                        Next.js internal routes
                                  |
                   +--------------+--------------+
                   |                             |
                Redis                       PostgreSQL
                   |                             |
          current serving state          historical / derived state
                   |                             |
                   +-------------+---------------+
                                 |
                                 v
                    TypeScript business logic
                                 |
                                 +--> dashboard / API responses
                                 |
                                 +--> cron-driven workers
```

The TLE pipeline is explicitly ingestion-first and keeps `GET /api/tle` side-effect free. The ingestion lifecycle is controlled through authenticated internal endpoints, including `/api/internal/ingest-tle`, while partition maintenance and trend processing are separate jobs. Current documentation also describes the external scheduler as `cron-job.org`, with hourly TLE ingestion, a 15-minute trend worker, partition maintenance, daily solar-flux refresh, and hourly geomagnetic/shadow refresh.

### Baseline invariants that must not be broken

The extraction must preserve these existing behaviors:

- TLE provider acquisition and fallback remain in TypeScript initially.
- Redis continues to own the current TLE serving snapshot.
- PostgreSQL remains the historical system of record.
- Ingestion remains serialized by the existing Redis lock.
- Provider fallback must not accidentally authorize destructive catalog pruning.
- `/api/tle` remains a pure read path.
- Existing partition maintenance remains independent from ingestion.
- Historical trend jobs remain durable and retryable.
- Cron cadence and endpoint contracts do not change merely because a calculation is moved to Python.

The architecture change is therefore a **compute-plane extraction**, not a scheduler, storage, or ingestion rewrite.

---

## 4. Target architecture

```text
                                      +----------------------+
                                      | External providers   |
                                      | ST / CelesTrak / NOAA|
                                      +----------+-----------+
                                                 |
                                                 v
                                      +----------------------+
                                      | Next.js application   |
                                      |-----------------------|
                                      | API routes            |
                                      | Auth / internal jobs  |
                                      | Redis / PostgreSQL     |
                                      | Provider integration  |
                                      | Orchestration          |
                                      +----------+-----------+
                                                 |
                              HTTPS / internal contract
                                                 |
                         +-----------------------+-----------------------+
                         |                       |                       |
                         v                       v                       v
                 /compute/reentry      /compute/trends        /compute/orbit
                         |                       |                       |
                         +-----------------------+-----------------------+
                                                 |
                                      +----------v-----------+
                                      | DRAKON Compute Engine |
                                      | FastAPI               |
                                      |-----------------------|
                                      | Pydantic contracts    |
                                      | Numerical services   |
                                      | Model registry        |
                                      | Scientific kernels   |
                                      | Batch operations     |
                                      +----------+-----------+
                                                 |
                         +-----------------------+-----------------------+
                         |                       |                       |
                         v                       v                       v
                      NumPy                   SciPy             domain libraries
                         |
                         v
                 orbital / re-entry / collision / analysis models

                     +--------------------------------------+
                     | Internal analysis / calibration       |
                     |--------------------------------------|
                     | replay datasets                       |
                     | benchmark scripts                     |
                     | parameter sweeps                      |
                     | model comparison                      |
                     | calibration reports                   |
                     +--------------------------------------+
```

### Core architectural rule

> **TypeScript decides what the application needs computed; Python owns the mathematics of how that computation is performed.**

TypeScript should not become a thin proxy around hundreds of Python functions. Likewise, Python should not become a second copy of the application backend.

---

## 5. Architectural boundaries

### 5.1 TypeScript remains responsible for

- Next.js UI and server components
- public and internal HTTP routing
- authentication and authorization
- internal job authentication
- provider access: Space-Track, CelesTrak, NOAA, TIP, etc.
- Redis access and cache policy
- PostgreSQL access and transaction boundaries
- cron/job orchestration
- locking, claiming, retry, and queue semantics
- object catalog lifecycle
- API response composition
- application-specific filtering and presentation transformations
- feature flags and rollout controls
- persistence of model outputs
- coordination of Python calls

### 5.2 Python becomes responsible for

- numerical kernels
- scientific calculations
- orbital mechanics calculations that are computationally meaningful
- statistical and regression calculations
- vectorized batch processing
- simulation
- optimization
- sensitivity analysis
- model calibration
- uncertainty calculations
- model-specific classification/scoring when those calculations are part of the scientific model
- reusable analysis functions used by both production and research tooling

### 5.3 Things Python should not own initially

Do **not** move these simply because Python exists:

- Space-Track authentication/session management
- CelesTrak provider implementations
- Redis session/cache ownership
- PostgreSQL schema ownership
- TLE ingestion locks
- ingestion snapshot merging
- catalog pruning authority
- cron scheduling
- public API routing
- dashboard-specific formatting
- UI labels/styles
- provider fallback policy
- partition lifecycle
- existing database queue semantics

Python is a compute subsystem first.

---

## 6. Proposed repository structure

Start with a contained Python application rather than a broad repository refactor.

```text
drakon/
├── app/                              # Existing Next.js application
│   ├── api/                          # Existing HTTP + internal job routes
│   ├── dashboard/
│   └── ...
│
├── components/                       # Existing UI components
│
├── lib/                              # TypeScript application/domain layer
│   ├── db/                            # PostgreSQL / Drizzle
│   ├── ingestion/                     # Provider orchestration + history writes
│   ├── jobs/                          # Existing job orchestration/persistence
│   ├── tle-providers/                 # Space-Track / CelesTrak
│   ├── spacetrack/                    # Session handling
│   ├── tip/                           # TIP integration
│   ├── redis.ts
│   ├── types.ts
│   └── ...                            # Remaining app/domain logic
│
├── python/                            # NEW: DRAKON Compute Engine
│   ├── app/
│   │   ├── main.py                    # FastAPI application entry point
│   │   ├── api/
│   │   │   ├── health.py
│   │   │   ├── reentry.py
│   │   │   ├── trends.py
│   │   │   ├── orbital.py
│   │   │   ├── collision.py
│   │   │   └── analysis.py
│   │   ├── models/
│   │   │   ├── common.py              # shared request/response models
│   │   │   ├── tle.py
│   │   │   ├── reentry.py
│   │   │   ├── trend.py
│   │   │   ├── orbital.py
│   │   │   └── collision.py
│   │   ├── core/
│   │   │   ├── model_registry.py
│   │   │   ├── model_version.py
│   │   │   └── configuration.py
│   │   └── services/
│   │       ├── orbital/
│   │       │   ├── tle.py
│   │       │   ├── elements.py
│   │       │   ├── kepler.py
│   │       │   ├── state_vectors.py
│   │       │   └── propagation.py
│   │       ├── reentry/
│   │       │   ├── bstar.py
│   │       │   ├── decay_rate.py
│   │       │   ├── signals.py
│   │       │   ├── confidence.py
│   │       │   ├── consensus.py
│   │       │   ├── estimator.py
│   │       │   └── model.py
│   │       ├── trends/
│   │       │   ├── regression.py
│   │       │   ├── windows.py
│   │       │   ├── weighting.py
│   │       │   └── classifier.py
│   │       ├── collision/
│   │       │   ├── density.py
│   │       │   ├── spatial_index.py
│   │       │   └── candidates.py
│   │       └── analysis/
│   │           ├── replay.py
│   │           ├── metrics.py
│   │           └── sensitivity.py
│   │
│   ├── analysis/
│   │   ├── README.md
│   │   ├── calibration/
│   │   ├── notebooks/
│   │   ├── replay/
│   │   └── benchmarks/
│   │
│   ├── tests/
│   │   ├── unit/
│   │   ├── numerical/
│   │   ├── golden/
│   │   ├── contract/
│   │   ├── integration/
│   │   └── performance/
│   │
│   ├── pyproject.toml
│   ├── uv.lock                         # if uv is adopted
│   └── README.md
│
├── docs/
│   ├── DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md
│   └── ...
│
├── package.json
└── ...
```

This structure intentionally avoids turning the repository into a premature Turborepo-style multi-application workspace. A single bounded `python/` subsystem is sufficient at the current scale.

---

## 7. Extraction classification for the existing `lib/`

The extraction should follow **function responsibility**, not file extension or file size.

### 7.1 `lib/satelliteHelpers.ts`

**Split rather than move wholesale.**

#### Extract to Python

These are strong candidates for the compute layer:

- numerical TLE field interpretation when used as part of a scientific model
- semi-major-axis calculation from mean motion
- perigee/apogee calculations
- orbital velocity calculations
- atmospheric-density proxies
- BSTAR interpretation where it feeds the re-entry model
- decay-rate equations
- altitude-based decay estimates
- mathematical plausibility/anomaly calculations
- re-entry time estimation
- model-specific numerical confidence transformations

The current `getReentryRisk()` path combines exactly these numerical operations with application classification and output assembly. The mathematical kernel should move; the application-facing orchestration should not be copied blindly.

#### Keep in TypeScript

- `formatDistance()` and other presentation formatting
- UI-oriented labels
- application-specific object classification when it is only a lightweight presentation concern
- response-shaping code specific to Next.js consumers
- any code that primarily decides whether/how to query storage or external systems

#### Preferred end state

```text
lib/satelliteHelpers.ts
        |
        +--> lightweight app helpers remain
        |
        +--> PythonComputeClient.reentry(...)

python/app/services/reentry/
        |
        +--> numerical/scientific implementation
```

Do not delete the TypeScript implementation until Python parity is established.

---

## 8. `lib/jobs/computeObjectTrends.ts`

This file should also be **split**, not replaced in one step.

### Keep in TypeScript

The following remain job-worker concerns:

- claiming `trend_jobs`
- `FOR UPDATE SKIP LOCKED`
- concurrency controls for job execution
- retry counts
- deleting successful jobs
- requeueing failed jobs
- reading historical records from PostgreSQL
- resolving object names/types from existing tables
- persistence into `object_trends`
- writing `trend_snapshots`
- deciding batch size and scheduler interaction

### Extract to Python

The numerical trend engine should move here:

- unweighted regression kernel
- weighted regression kernel
- recency weighting
- time-window selection
- trend statistics
- slopes, R², means, standard deviations
- signal-strength calculations
- confidence aggregation
- maneuver likelihood calculations
- consensus calculations when they are part of the model definition
- trend-derived re-entry estimation

The TypeScript worker should eventually become an orchestrator:

```text
trend_jobs
    |
    +--> read data
    |
    +--> build canonical compute input
    |
    +--> call Python batch compute
    |
    +--> validate response
    |
    +--> persist object_trends
    |
    +--> write trend_snapshots
```

This preserves the existing queue durability while moving the mathematics into a reusable service.

---

## 9. `lib/explainReentryTrend.ts`

This is one of the strongest candidates for Python extraction because it is already structured around mathematical signal processing.

### Extract

- `RegressionResult` equivalent as a Python model
- signal-strength formulas
- weighted evidence combination
- maneuver likelihood calculation
- decay classification
- payload consensus evaluation
- re-entry estimate mathematics
- confidence ceilings and model scoring

### Keep / recreate in TypeScript only as a consumer boundary

TypeScript can continue to expose a convenient application-level `ReentryRisk` shape, but the scientific calculation itself should come from Python.

The implementation should not be duplicated long-term.

---

## 10. Collision-density and future orbital workloads

The collision-density subsystem is a good **second-wave** candidate once the Python foundation is stable.

Potential future Python services include:

```text
/compute/collision/density
/compute/collision/candidates
/compute/orbit/state
/compute/orbit/propagate
/compute/orbit/ground-track
```

The current TypeScript worker/client data structures should remain compatible at the API boundary. Python can initially return the same logical fields rather than forcing UI changes.

For collision-density work, batch/vectorized input should be the default architectural pattern:

```json
{
  "objects": [...],
  "voxel_size_km": 25,
  "detection_radius_km": 50,
  "grid_cell_size_deg": 2
}
```

The service should not require one HTTP call per satellite. Network overhead will quickly dominate numerical work at that scale.

---

## 11. New Python API design

FastAPI exists primarily as the boundary around the compute engine. The API layer should remain thin.

### Example endpoint groups

```text
GET  /health
GET  /models
GET  /models/{model_id}

POST /compute/reentry
POST /compute/reentry/batch
POST /compute/trends
POST /compute/orbit/state
POST /compute/orbit/propagate
POST /compute/collision/density
POST /compute/collision/candidates

POST /analysis/replay
POST /analysis/sensitivity
POST /analysis/benchmark
```

### Endpoint design rules

1. **Thin routes.** Routes validate input, invoke a service, and return a typed response.
2. **No database access in the mathematical service layer.** Inputs should arrive as explicit data structures.
3. **No hidden external network access from model functions.** A numerical model must be deterministic with respect to its declared inputs.
4. **Batch endpoints are preferred for worker workloads.** Avoid per-object HTTP calls for scheduled processing.
5. **Interactive requests should remain small.** Long-running analyses should eventually move to asynchronous job execution.
6. **Model metadata is mandatory.** Every model response identifies the model version that produced it.

---

## 12. Contracts between TypeScript and Python

Do not attempt to import TypeScript types into Python or Python classes into TypeScript.

Use an explicit contract at the service boundary.

### Phase 1 contract

Pydantic models in Python define the request/response contract.

### Phase 2 contract hardening

Introduce a small repository-level contract directory when the number of services grows:

```text
contracts/
├── compute/
│   ├── reentry.v1.schema.json
│   ├── trends.v1.schema.json
│   ├── orbit.v1.schema.json
│   └── collision.v1.schema.json
└── README.md
```

The OpenAPI schema emitted by FastAPI can become the machine-readable source for frontend client typing once the API stabilizes.

### Contract rules

- breaking changes require a versioned contract
- additive response fields are preferred where possible
- unit names must be explicit in field names or schema documentation
- timestamps are ISO-8601 UTC
- distances use km unless otherwise documented
- velocities use km/s unless otherwise documented
- rates include their time basis
- null means unavailable/indeterminate, not zero
- enumerated scientific states must be explicit

---

## 13. Model versioning — mandatory

Model versioning becomes a first-class capability of the DRAKON Compute Engine.

Do not use API version alone as scientific model version. They are different concerns.

### 13.1 Model identity

Each scientific model should have:

```text
model_id
model_version
parameter_set_id
calibration_version
```

Example:

```text
model_id            = reentry_screen
model_version       = 0.2.0
parameter_set_id    = reentry-2026-09-baseline
calibration_version= cal-2026-09-01
```

### 13.2 Result metadata

Every compute result should include, at minimum:

```json
{
  "model": {
    "id": "reentry_screen",
    "version": "0.2.0",
    "parameter_set": "reentry-2026-09-baseline",
    "calibration_version": "cal-2026-09-01"
  },
  "computed_at": "2026-09-03T00:00:00Z",
  "engine_version": "0.1.0"
}
```

### 13.3 Versioning rules

**Patch version:** implementation corrections that do not intentionally change model behavior.  
**Minor version:** new calculation components or materially changed parameters while retaining the same conceptual model.  
**Major version:** incompatible methodology or interpretation changes.

Any change that could change historical outputs should be treated as a model version change even if the API shape does not change.

### 13.4 Existing `trendVersion`

The current trend worker already uses `CURRENT_TREND_VERSION = 4`. This concept should be preserved during migration, but eventually expanded into a more explicit model identifier/version scheme.

Recommended future persistence metadata:

```text
trend_model_id
trend_model_version
trend_parameter_set
trend_calibration_version
```

The old `trendVersion` field may remain as a compatibility field during transition.

---

## 14. Model registry

Create a lightweight Python model registry rather than scattering version constants through endpoint files.

```python
MODEL_REGISTRY = {
    "reentry_screen": {
        "version": "0.1.0",
        "parameter_set": "default-2026-09",
        "status": "production",
    },
    "reentry_trend": {
        "version": "0.1.0",
        "parameter_set": "default-2026-09",
        "status": "shadow",
    },
}
```

The registry should support states such as:

```text
experimental
shadow
canary
production
deprecated
```

This allows a new model to exist beside the old one without an immediate replacement.

---

## 15. Extraction sequence — start to finish

The migration should proceed through explicit gates.

### Phase 0 — Freeze the architectural boundary

**Goal:** prevent accidental cross-contamination while Python is introduced.

Actions:

- document the compute/application boundary
- inventory current numerical functions in `lib/`
- identify all callers of the candidate functions
- identify which outputs are persisted
- record current cron endpoints and scheduler cadence
- add a feature-flag convention for compute-engine calls
- establish Python coding/testing conventions

**Do not change production computation yet.**

Exit criteria:

- candidate extraction list is reviewed
- no cron endpoint needs a route rename
- rollback to current TypeScript is still one configuration change away

---

### Phase 1 — Create the Python subsystem

Create:

```text
python/
├── app/
├── tests/
├── analysis/
├── pyproject.toml
└── README.md
```

Install only the foundation dependencies first:

```text
fastapi
pydantic
uvicorn
numpy
pytest
```

Add `scipy`, `sgp4`, `astropy`, or other packages only when a migrated model actually needs them.

The first FastAPI application should expose only:

```text
GET /health
GET /models
```

No production route should call it yet.

---

### Phase 2 — Establish local developer workflow

Run both runtimes independently:

```text
Next.js       http://localhost:3000
FastAPI       http://localhost:8000
```

Add a simple developer command convention, for example:

```text
npm run dev:web
npm run dev:compute
```

or use a single development helper script to run both processes.

The Next.js application should refer to a configurable internal base URL:

```text
COMPUTE_ENGINE_URL=http://localhost:8000
```

Do not hard-code production hostnames.

---

### Phase 3 — Extract the smallest pure numerical kernel

Start with pure functions from `satelliteHelpers.ts`, not the entire `getReentryRisk()` function.

Recommended sequence:

1. TLE numerical parsing
2. semi-major-axis / perigee / apogee calculations
3. BSTAR parsing
4. orbital velocity
5. decay-rate kernel
6. anomaly/plausibility guards
7. re-entry estimate

Each function gets a Python unit test before being connected to FastAPI.

This provides a scientific foundation without yet changing application behavior.

---

### Phase 4 — Build golden/parity tests

For each extracted function, create golden inputs from real DRAKON observations and deterministic fixtures.

```text
TypeScript implementation
          |
          +--> golden input --> expected result

Python implementation
          |
          +--> same input --> compare
```

Use numerical tolerances where appropriate. Do not compare serialized floating-point text character-for-character.

For categorical values (`stable`, `warning`, `critical`, etc.), require exact equality.

Store the golden fixtures outside the UI code so they can be reused by both production tests and calibration analysis.

---

### Phase 5 — Extract the re-entry model

Once primitives match, move the actual model into Python:

```text
python/app/services/reentry/
├── bstar.py
├── decay_rate.py
├── signals.py
├── confidence.py
├── consensus.py
├── estimator.py
└── model.py
```

Keep the first Python version **mathematically equivalent** to the current production implementation.

Do not improve the model in the same pull request as the language migration.

This is critical for separating:

```text
migration differences
```

from:

```text
scientific/model changes
```

---

### Phase 6 — Introduce FastAPI around the model

Expose:

```text
POST /compute/reentry
```

and later:

```text
POST /compute/reentry/batch
```

The FastAPI route must not read Redis or PostgreSQL for the initial implementation. The Next.js layer supplies the required input.

This keeps the scientific model deterministic and testable.

---

### Phase 7 — Shadow mode

Do not replace the TypeScript result immediately.

Instead:

```text
Incoming application request
          |
          +--> TypeScript model -----> authoritative result
          |
          +--> Python model ---------> shadow result
                                      |
                                      +--> compare metrics
```

Record:

- model version
- input identity
- TypeScript result
- Python result
- absolute/relative numerical delta
- categorical disagreement
- execution time
- error/timeout

The TypeScript result remains authoritative.

Shadow mode may be implemented for interactive endpoints and for selected scheduled jobs.

---

### Phase 8 — Canary rollout

After a sufficient shadow sample:

```text
feature flag = 1%
        |
        v
Python authoritative for a small population
        |
        +--> TypeScript fallback on failure
```

Then increase gradually.

Recommended rollout controls:

```text
COMPUTE_ENGINE_ENABLED=false
COMPUTE_ENGINE_SHADOW=true
COMPUTE_ENGINE_CANARY_PERCENT=0
```

Later:

```text
COMPUTE_ENGINE_ENABLED=true
COMPUTE_ENGINE_SHADOW=false
COMPUTE_ENGINE_CANARY_PERCENT=100
```

The exact configuration naming is implementation detail; the operational behavior is mandatory.

---

### Phase 9 — Extract historical trend mathematics

After the re-entry screen is stable, move the numerical core from:

```text
lib/jobs/computeObjectTrends.ts
lib/explainReentryTrend.ts
```

to:

```text
python/app/services/trends/
python/app/services/reentry/
```

The existing TypeScript worker remains the coordinator.

Recommended request shape:

```text
POST /compute/trends
{
  objects: [
    {
      norad_id: 12345,
      epochs: [...]
    }
  ]
}
```

For production worker workloads, prefer one request containing a batch of objects rather than one request per object.

---

### Phase 10 — Production worker integration

The existing `process-trends` cron endpoint remains unchanged.

The control flow becomes:

```text
cron-job.org
      |
      v
POST /api/internal/process-trends
      |
      +--> claim trend_jobs
      |
      +--> read historical data
      |
      +--> build Python input batch
      |
      +--> call /compute/trends
      |
      +--> validate model/version
      |
      +--> persist object_trends
      |
      +--> delete completed jobs
      |
      +--> retry failures
```

The queue, lock/claim semantics, retry semantics, and persistence stay in TypeScript.

Python is a computational dependency, not the queue owner.

---

### Phase 11 — Analysis and calibration layer

Only after the production model is stable should Python's research/analysis tooling become a first-class subsystem.

Add:

```text
python/analysis/
├── calibration/
├── replay/
├── sensitivity/
├── benchmarks/
└── notebooks/
```

The analysis layer imports the exact same production model modules.

Example:

```text
production:
    app.services.reentry.model.calculate(...)

analysis:
    analysis.calibration.run_reentry_sweep(...)
            |
            +--> same model implementation
```

This prevents the common failure mode where the research notebook and production model silently diverge.

---

### Phase 12 — Extract future compute domains

After the foundation is stable, extract in roughly this order:

1. re-entry model
2. trend/regression model
3. collision density
4. close-approach/candidate analysis
5. orbital state/propagation utilities
6. richer atmospheric models
7. uncertainty/Monte Carlo services
8. larger simulation and optimization workloads

Do not migrate a component solely for stylistic consistency. Extract it when Python materially improves scientific clarity, capability, or workload characteristics.

---

## 16. Cron and pipeline non-disruption policy

This is a hard requirement.

### 16.1 Existing cron endpoints remain unchanged initially

The following existing operational endpoints remain under Next.js control:

```text
POST /api/internal/ingest-tle
POST /api/internal/process-trends
POST /api/internal/manage-tle-partitions
POST /api/internal/requeue-stale
POST /api/internal/geomagnetic-shadow
POST /api/internal/geomagnetic-shadow/replay
POST /api/solar-flux
```

The external scheduler continues to invoke the same endpoints at the same cadence.

### 16.2 No scheduler migration during extraction

Do not combine the Python introduction with a migration from `cron-job.org` to another scheduler.

Scheduler migration and compute migration are independent changes.

### 16.3 No ingestion rewrite

Do not move `runIngestionCycle()` into Python during the initial extraction.

Specifically, Python must not initially become responsible for:

- Space-Track calls
- CelesTrak fallback
- provider health decisions
- Redis ingestion lock
- snapshot merge
- pruning authority
- historical row insertion
- partition management

### 16.4 No synchronous Python dependency in ingestion

`/api/internal/ingest-tle` should not fail merely because the compute service is unavailable.

TLE ingestion must remain independently operable.

If a future ingestion calculation truly requires Python, use a fail-safe design where the ingestion state remains safe and the compute task can be retried independently.

### 16.5 Trend worker failure isolation

During the transition, a Python failure must behave like a failed trend computation, not a failed ingestion cycle.

The worker should:

```text
claim job
   |
Python compute fails
   |
requeue job / increment retry
   |
continue processing other jobs
```

Do not mark a job completed if Python returned an invalid or mismatched model result.

### 16.6 Timeout policy

All TypeScript -> Python calls must have explicit timeouts.

For a timeout/error:

- interactive path: use a documented fallback if safe
- background worker: retry/requeue
- ingestion: do not block the ingestion pipeline

Timeouts must be observable.

---

## 17. Deployment strategy

There are two valid deployment stages, but they should not be confused.

### 17.1 Stage A — same Vercel project for early integration

Vercel currently supports Python/FastAPI deployment alongside Next.js and provides an official Next.js + FastAPI monorepo pattern. This makes it a valid way to prove the architecture with one repository/project and minimal infrastructure.

For example:

```text
drakon/
├── app/        # Next.js
├── lib/
└── api/        # Vercel Python functions
```

However, that simple Vercel layout is not the target repository structure for DRAKON's long-term compute subsystem. DRAKON's Python service is expected to contain increasingly substantial numerical and analysis workloads, so a dedicated service boundary is preferable for production scaling.

### 17.2 Stage B — recommended production architecture

Use the same Git repository but deploy Python as a **separate containerized FastAPI service**.

```text
GitHub repository
      |
      +------------------------+
      |                        |
      v                        v
   Vercel                 Python service
   Next.js                 FastAPI
      |                        |
      +----------HTTPS---------+
               |
               v
          DRAKON Compute
```

The exact hosting provider can be chosen independently of the repository architecture. The deployment should support:

- persistent service/process lifecycle
- container/image builds
- CPU/memory sizing
- configurable concurrency
- private networking or authenticated HTTPS
- logs/metrics
- rolling deploys
- independent scaling
- background worker capability when eventually required

### 17.3 Why separate deployment is preferred long-term

A separate service makes it possible to scale numerical workloads without scaling the web application.

Example:

```text
2 web instances
8 compute workers
```

rather than coupling both to the same scaling unit.

It also makes future additions such as multiprocessing, batch workers, numerical native dependencies, or asynchronous compute jobs easier to operate.

### 17.4 Deployment transition

The deployment order should be:

```text
local Python
    |
    v
same-repo staging
    |
    v
Vercel proof deployment OR container staging
    |
    v
shadow production service
    |
    v
canary
    |
    v
production compute service
```

The Next.js application should always use a configurable `COMPUTE_ENGINE_URL` rather than embedding infrastructure-specific hostnames.

---

## 18. Authentication between Next.js and Python

The compute service should not be treated as a public anonymous API.

At minimum, implement one of:

- private network access; or
- signed internal requests; or
- an internal service token.

The application should validate Python responses against expected contracts and model versions.

Do not expose calibration or internal analysis endpoints publicly.

Recommended logical separation:

```text
public dashboard
    |
    v
Next.js
    |
    +--> authenticated compute service

internal analysis tooling
    |
    v
Python analysis modules / restricted analysis API
```

---

## 19. Testing strategy

The migration requires more than normal unit tests because scientific outputs can change subtly without producing obvious runtime errors.

### 19.1 Python unit tests

Test pure functions independently:

- TLE numeric parsing
- Kepler calculations
- BSTAR parsing
- orbital velocity
- decay equations
- weighting functions
- regressions
- signal strengths
- confidence calculations
- tier assignment

### 19.2 Numerical invariant tests

Add invariants where mathematically meaningful.

Examples:

```text
semi-major axis > Earth radius for a valid orbit
perigee <= apogee
R² in [0, 1]
confidence in [0, 1]
probability-like scores in [0, 1]
negative physical rates are not silently converted into positive decay
```

### 19.3 Golden tests

Use known DRAKON inputs and expected results.

Golden datasets should include:

- normal debris
- stable debris
- active payload
- maneuvering payload
- high-altitude false-positive candidates
- terminal/low-perigee objects
- malformed or incomplete TLE input
- Alpha-5 catalog identifiers where relevant

### 19.4 TypeScript/Python parity tests

During extraction, run both implementations on the same fixture set.

This should be a temporary but explicit test suite.

### 19.5 Contract tests

Validate that:

- FastAPI request schemas accept what the Next.js client sends
- response fields and null semantics are stable
- model metadata is always present
- unknown enum states fail safely

### 19.6 Integration tests

Test:

```text
Next.js -> Python
Python -> response
Next.js -> persistence
```

But keep scientific unit tests independent of HTTP so service failures can be localized.

### 19.7 Performance tests

Record baseline numbers before extraction:

```text
TypeScript computation time
Python computation time
batch size
CPU time
memory
objects/sec
request latency
```

Do not assume Python is faster merely because it is Python. The benefit may come from vectorization or better numerical libraries rather than the language itself.

---

## 20. Internal analysis and calibration architecture

The analysis subsystem should be a first-class consumer of the compute engine, not a separate implementation.

### 20.1 Reproducible analysis

Every analysis run should record:

```text
model_id
model_version
parameter_set_id
calibration_version
input dataset identifier
code/engine version
run timestamp
random seed (when applicable)
```

### 20.2 Calibration workflow

```text
Historical dataset
      |
      v
analysis/replay
      |
      v
model evaluation
      |
      +--> parameter sweep
      |
      +--> sensitivity analysis
      |
      +--> error metrics
      |
      v
candidate parameter set
      |
      v
validation dataset
      |
      v
approved calibration version
      |
      v
model registry
```

### 20.3 Training/calibration separation

Even if DRAKON does not use machine learning, preserve a conceptual distinction between:

- algorithm implementation
- parameters
- calibration data
- validation data

Do not embed tuned values directly into a model function without identifying their parameter-set version.

### 20.4 Dataset discipline

Large historical datasets should not be copied into the production application package.

Use lightweight fixtures in Git and external/object storage for larger analysis datasets when necessary.

---

## 21. Model validation and scientific governance

For every model that reaches production, document:

```text
Purpose
Inputs
Outputs
Units
Assumptions
Known limitations
Calibration data
Validation data
Parameter set
Version
Fallback behavior
Failure modes
```

For DRAKON specifically, this prevents a scientific approximation from being accidentally treated as a high-fidelity physical propagator merely because its implementation lives inside a production service.

The existing re-entry documentation correctly distinguishes the current system as a screening model and identifies limitations such as simplified atmospheric representation and incomplete environmental/attitude modeling. That distinction should remain part of the model metadata and documentation as the Python implementation becomes more sophisticated.

---

## 22. Synchronous vs asynchronous compute

The Compute Engine should support two execution classes.

### 22.1 Synchronous compute

Use for:

- one-object re-entry estimation
- one-object orbital calculation
- small interactive analysis
- dashboard requests that must respond immediately

```text
HTTP request
   |
   v
FastAPI
   |
   v
model
   |
   v
response
```

### 22.2 Asynchronous/batch compute

Use for:

- 15k-object analysis
- historical trend recomputation
- large collision-density jobs
- Monte Carlo simulations
- parameter sweeps
- backfills
- model reprocessing after a new model version

Long-term architecture:

```text
Next.js job route
       |
       v
persistent job record
       |
       v
compute worker
       |
       v
Python batch model
       |
       v
result store
```

Do not turn synchronous HTTP endpoints into pseudo-workers by simply increasing request timeouts.

---

## 23. Batch design guidelines

For high-throughput services:

- prefer batch requests over per-object calls
- minimize JSON serialization size
- avoid repeatedly sending the same metadata
- pass compact numeric arrays where appropriate
- vectorize calculations inside Python
- separate batch orchestration from model kernels
- avoid database round trips from individual model calls

Example future design:

```text
TypeScript worker
      |
      +--> fetch 100 objects of historical data
      |
      +--> POST one batch
      |
      v
Python vectorized calculation
      |
      +--> 100 results
      |
      v
TypeScript persistence
```

Batch size should be measured and tuned rather than hard-coded permanently.

---

## 24. Error handling contract

Python errors fall into explicit categories.

### Invalid input

Return a validation error. Do not calculate from malformed data.

### Model indeterminate

Return a valid result with null/explicitly indeterminate fields when the science cannot support a conclusion.

This is different from an HTTP failure.

### Model execution failure

Return a service error and let the caller decide whether to retry/fallback.

### Dependency/infrastructure failure

Return a service-unavailable condition. Existing TypeScript job semantics handle retry/fallback.

Never silently convert a computation exception into a `stable` scientific result.

---

## 25. Observability

The Compute Engine should emit structured telemetry for every production calculation.

Recommended fields:

```text
request_id
model_id
model_version
parameter_set_id
engine_version
object_count
execution_ms
queue_wait_ms (if async)
status
fallback_used
```

For scientific debugging, log enough metadata to reproduce an issue but avoid logging entire large catalogs by default.

### Key operational metrics

```text
compute_requests_total
compute_failures_total
compute_timeouts_total
compute_duration_ms
model_disagreements_total
model_version_usage
batch_size
objects_per_second
```

During shadow mode, disagreement rate is a primary rollout metric.

---

## 26. Database strategy during extraction

Do not move the database schema to Python during the initial phases.

The current PostgreSQL schema already stores normalized orbital fields, trend outputs, signal strengths, confidence, and re-entry information. Continue using that schema as the persistence contract while the compute engine is introduced.

### Transitional pattern

```text
PostgreSQL
    |
    v
Next.js worker
    |
    +--> canonical compute input
    |
    v
Python
    |
    v
canonical compute result
    |
    v
Next.js worker
    |
    v
PostgreSQL
```

### Future possibility

A Python worker may eventually read/write selected analytical tables directly, but this should be an explicit later architecture decision, not an automatic consequence of introducing FastAPI.

---

## 27. Security and secret ownership

Keep external provider secrets in the service that currently owns those integrations.

Examples:

```text
Space-Track credentials -> Next.js/server environment
Redis credentials       -> Next.js/server environment
Postgres credentials    -> Next.js/server environment
Compute service token   -> both services
```

Python should not receive secrets it does not need.

The compute service should accept data, not become the universal holder of DRAKON credentials.

---

## 28. Rollback strategy

Every extraction must preserve a one-step rollback path.

### Interactive path rollback

```text
COMPUTE_ENGINE_ENABLED=false
        |
        v
TypeScript implementation becomes authoritative
```

### Background worker rollback

The `process-trends` route must retain a TypeScript fallback or an explicit legacy mode until Python has been proven in production.

### Model rollback

If `model_version = 0.2.0` produces unexpected results:

```text
registry
   |
   +--> mark 0.2.0 deprecated/disabled
   |
   +--> restore 0.1.0 as active
```

Do not rewrite historical data simply to hide a bad deployment. Preserve the original version metadata and perform an explicit reprocessing decision.

---

## 29. Recommended migration order by code area

| Priority | Current area | Extraction target | Keep in TS | Reason |
| --- | --- | --- | --- | --- |
| 1 | `lib/satelliteHelpers.ts` | orbital/re-entry numerical kernels | formatting + app helpers | Small, pure, testable boundary |
| 2 | `lib/explainReentryTrend.ts` | signal/confidence/re-entry model | API/result composition | Strong mathematical boundary |
| 3 | `lib/jobs/computeObjectTrends.ts` | regression/weighting/statistics | queue + DB orchestration | Highest recurring analytical value |
| 4 | collision-density logic | density/spatial calculations | job/UI orchestration | Batch/vectorization opportunity |
| 5 | orbital-state utilities | state vectors/propagation | API + caching | Scientific ecosystem benefit |
| 6 | future atmospheric models | thermosphere/drag models | environment-data acquisition | Expensive numerical modeling |

---

## 30. What must not be extracted prematurely

Do not create Python equivalents of every TypeScript utility just to make the architecture look symmetrical.

Specifically avoid an early migration of:

- Redis wrappers
- database repositories
- provider adapters
- Space-Track sessions
- TLE ingestion orchestration
- partition management
- API-only transformations
- UI-specific helpers
- small business rules with no numerical complexity

A service should move only when at least one of these is true:

1. the mathematics is significantly clearer in Python;
2. a scientific library materially improves correctness/capability;
3. vectorized/batch execution is needed;
4. the same model must be reused by production and analysis tooling;
5. the workload needs independent compute scaling.

---

## 31. Local and CI commands

The repository should eventually expose a small set of explicit commands.

Example:

```text
# Next.js
npm run dev
npm test

# Python
cd python
python -m pytest
uvicorn app.main:app --reload --port 8000
```

CI should run both stacks independently.

Recommended CI stages:

```text
TypeScript lint/test
        |
        +-------------------+
                            |
Python lint/test            |
        |                   |
        +---------+---------+
                  |
           contract tests
                  |
           parity/golden tests
                  |
           build/deploy checks
```

Do not make a temporary experimental notebook dependency block the production TypeScript build.

---

## 32. CI quality gates for model changes

A production model change should not be considered complete merely because unit tests pass.

Require:

- unit tests pass
- golden tests pass
- parity tests reviewed when replacing an existing model
- contract tests pass
- performance benchmark compared with baseline
- model version bumped when outputs can change
- calibration/parameter-set version updated when tuned parameters change
- model documentation updated when assumptions change
- rollback path verified

---

## 33. Definition of done for the first extraction

The first migration is complete when all of the following are true:

### Architecture

- `python/` is an isolated Compute Engine subsystem.
- FastAPI exposes a health endpoint and at least one compute endpoint.
- Next.js accesses Python through a configurable service URL.
- No provider/storage responsibilities have been accidentally duplicated.

### Scientific correctness

- migrated model matches the TypeScript implementation within agreed numerical tolerances
- categorical outputs match exactly for the golden dataset
- known edge cases are tested
- units are explicit

### Operations

- existing cron schedules remain unchanged
- ingestion remains independent of Python availability
- trend failures still requeue correctly
- Python timeout/error behavior is defined
- rollback to TypeScript is available by configuration

### Governance

- model ID/version is returned with every result
- parameter-set/calibration metadata exists
- production model version is documented
- analysis tooling uses the same production model module

### Deployment

- Python service is deployable independently
- staging and production compute URLs are configurable
- service authentication is enabled
- logs expose request/model/version/timing metadata

---

## 34. Suggested first implementation tree

Do not create the complete future architecture on day one. The first implementation can be deliberately small:

```text
python/
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── health.py
│   │   └── reentry.py
│   ├── models/
│   │   └── reentry.py
│   ├── core/
│   │   ├── model_version.py
│   │   └── configuration.py
│   └── services/
│       └── reentry/
│           ├── tle.py
│           ├── bstar.py
│           ├── decay_rate.py
│           ├── signals.py
│           └── model.py
│
├── analysis/
│   └── README.md
│
├── tests/
│   ├── unit/
│   ├── golden/
│   └── contract/
│
├── pyproject.toml
└── README.md
```

Then expand only after the first model proves the architecture.

---

## 35. Recommended first migration in DRAKON

The first production candidate should be the **re-entry numerical model**, but it should be extracted in two logical stages:

```text
Stage A
satelliteHelpers.ts
    |
    +--> pure Python numerical kernels

Stage B
satelliteHelpers.ts + explainReentryTrend.ts
    |
    +--> Python re-entry model
```

The reason to start there is that it gives DRAKON a meaningful scientific workload while keeping the surrounding application behavior stable. The current model already contains explicit physical approximations, calibrated constants, confidence/sanity guards, and tier logic; those are precisely the pieces that benefit from becoming a separately testable scientific module.

After parity, the historical trend worker is the next high-value extraction because it can consume the same re-entry model and Python statistical primitives while leaving its durable PostgreSQL job machinery untouched.

---

## 36. Long-term architecture

Once the system matures, DRAKON should conceptually look like this:

```text
                                DRAKON

            +-------------------------------------------+
            |              Application Plane            |
            |-------------------------------------------|
            | Next.js / TypeScript                      |
            | UI / APIs / Auth / Providers              |
            | Redis / Postgres / Job orchestration      |
            +----------------------+--------------------+
                                   |
                            Compute contract
                                   |
            +----------------------v--------------------+
            |              Compute Plane                |
            |-------------------------------------------|
            | FastAPI                                    |
            | Model registry / versions                  |
            | Numerical kernels                          |
            | Batch compute                              |
            | Scientific domain libraries                |
            +----------------------+--------------------+
                                   |
             +---------------------+----------------------+
             |                     |                      |
             v                     v                      v
          Re-entry              Orbital              Collision
          models                models               models
             |                     |                      |
             +---------------------+----------------------+
                                   |
                                   v
                         Analysis / Calibration
                                   |
                      replay / sensitivity / fitting
                                   |
                                   v
                         validated model versions
```

The critical property is **independence of change**:

- UI changes should not require model changes.
- Provider changes should not require model rewrites.
- Model experiments should not require dashboard changes.
- Model recalibration should not require scheduler migration.
- Compute scaling should not require web-app scaling.
- A failed Python deployment should not corrupt the TLE ingestion pipeline.

---

## 37. Architectural principles to preserve

1. **Compute is a subsystem, not a second application backend.**
2. **Pure mathematics should remain independent of storage and network access.**
3. **Production and analysis use the same model implementation.**
4. **Model versions are explicit and immutable.**
5. **Cron remains an orchestration concern.**
6. **Storage ownership remains explicit.**
7. **Batch computation is preferred for large workloads.**
8. **Every migration has a parity phase and a rollback path.**
9. **A scientific result must carry enough metadata to explain how it was produced.**
10. **Do not migrate code merely to satisfy architectural symmetry; migrate where Python materially improves DRAKON.**

---

## 38. External deployment references

The following official Vercel references were used when defining the deployment options in this document:

- Vercel — Next.js + FastAPI starter / monorepo: https://vercel.com/templates/fast-api/next-js-fastapi-starter
- Vercel Academy — Python on Vercel: https://vercel.com/academy/python-on-vercel
- Vercel Academy — Deploy Next.js + FastAPI to production: https://vercel.com/academy/python-on-vercel/deploy-to-prod
- Vercel Knowledge Base — FastAPI: https://vercel.com/kb/fastapi

As of this plan's baseline review, Vercel documents both single-project Next.js + FastAPI deployment and multi-service patterns. The recommended long-term DRAKON architecture still keeps the compute boundary independent so heavy numerical workloads can scale separately from the web application.

---

## 39. Final implementation checklist

### Foundation

- [ ] Create `python/` subsystem
- [ ] Add FastAPI application
- [ ] Add Python dependency management
- [ ] Add `/health`
- [ ] Add model registry/version metadata
- [ ] Add local two-process development workflow

### Re-entry extraction

- [ ] Identify all current TypeScript call sites
- [ ] Extract TLE numerical primitives
- [ ] Extract BSTAR/decay-rate calculations
- [ ] Extract re-entry estimator
- [ ] Add Python unit tests
- [ ] Add golden fixtures
- [ ] Add TypeScript/Python parity tests
- [ ] Add `/compute/reentry`
- [ ] Add shadow mode
- [ ] Add canary rollout
- [ ] Switch production authority only after parity review

### Trend extraction

- [ ] Extract regression kernels
- [ ] Extract weighting/window calculations
- [ ] Extract signal/confidence logic
- [ ] Add batch compute endpoint
- [ ] Keep job claim/retry/persistence in TypeScript
- [ ] Add model version to persisted trend outputs
- [ ] Validate background worker failure isolation

### Analysis/calibration

- [ ] Add `python/analysis/`
- [ ] Add replay tooling
- [ ] Add sensitivity/parameter sweeps
- [ ] Add calibration datasets
- [ ] Add calibration version IDs
- [ ] Add reproducibility metadata
- [ ] Add benchmarks

### Deployment

- [ ] Add staging Compute Engine
- [ ] Add authenticated service-to-service requests
- [ ] Add `COMPUTE_ENGINE_URL`
- [ ] Add timeouts and retry semantics
- [ ] Add compute telemetry
- [ ] Decide on Vercel-only vs dedicated production service based on workload measurements
- [ ] Keep cron endpoints and scheduler cadence unchanged during migration

### Governance

- [ ] Model version required on every result
- [ ] Parameter/calibration version recorded
- [ ] Model changes require version review
- [ ] Production model has documented assumptions/limitations
- [ ] Rollback path tested

---

## 40. Architectural end state

The success criterion is not "DRAKON now uses Python."

The success criterion is:

> **DRAKON has a stable application plane and a scientifically disciplined compute plane, where mathematically heavy models can evolve, validate, calibrate, benchmark, version, and scale independently without disturbing the operational data pipelines that keep the system alive.**

That is the boundary this extraction should establish.
