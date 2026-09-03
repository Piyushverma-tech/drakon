# DRAKON Compute Engine — Python/FastAPI Extraction & Architecture Plan

**Status:** Proposed architecture  
**Baseline reviewed:** `bf12871c7e712ac5a555bd354c879044406d8336`  
**Document revision:** 2  
**Scope:** Introduce Python + FastAPI as a dedicated server-side scientific compute service inside the existing DRAKON repository, while preserving the current Next.js API surface, browser-side real-time computation, Redis/PostgreSQL ownership, and cron-driven operational pipelines.

---

## 1. Executive decision

DRAKON should evolve into a **three-plane system**, not a Next.js application with a generic Python backend:

1. **Browser Compute Plane** — existing TypeScript/Web Worker computation for interactive globe workloads. This remains local to the browser.
2. **Application Plane** — existing Next.js + TypeScript application. It owns `/api/*`, providers, Redis, PostgreSQL, cron orchestration, job claiming, persistence, and application-facing responses.
3. **DRAKON Compute Engine** — new Python + FastAPI service for server-side scientific/numerical models, heavy algorithms, simulation, calibration, and reusable internal analysis.

The services are deployed as **Vercel Services in the same Vercel project and repository**. The Next.js application remains the primary web service. The Python service has its own root, dependency environment, and FastAPI entrypoint. It is private by default and is reached from server-side Next.js code through a Vercel Service Binding rather than a public client-facing route. Vercel documents this pattern for multi-service projects and FastAPI backends, including service roots, bindings, and per-service runtime configuration. citeturn639927search1turn639927search4

The target repository shape is:

```text
drakon/
├── app/                         # Next.js App Router — unchanged
│   └── api/                     # 100% TypeScript; owns /api/*
│
├── lib/                         # existing TS application/domain code
│
├── backend/                     # NEW: DRAKON Compute Engine
│   ├── pyproject.toml           # Python dependencies/configuration
│   ├── main.py                  # app = FastAPI()
│   ├── contracts.py             # Pydantic API contracts
│   └── compute/
│       ├── reentry.py           # first model family
│       ├── orbit.py              # future server-side orbital models
│       └── ...
│
├── vercel.json                  # Vercel Services configuration
├── package.json
└── ...
```

The goal is **not** to rewrite DRAKON in Python. The goal is to create a clean scientific boundary that can grow from a small re-entry model into a reusable compute platform without forcing the web application, browser visualization, or operational pipeline to move with it.

---

## 2. Architectural principles

### 2.1 Compute placement follows workload characteristics

Not every computation should move to Python.

A workload remains in the browser when latency is part of the product experience. A workload remains in TypeScript when it is primarily application orchestration, persistence, or integration logic. A workload moves to Python when its scientific complexity, numerical ecosystem, batch characteristics, analysis lifecycle, or independent server-side compute requirements justify the boundary.

### 2.2 `/api/*` remains a TypeScript contract

The existing Next.js App Router API namespace is not being replaced with FastAPI routes. Existing clients, cron jobs, and internal integrations continue to call the same paths.

Python is an implementation dependency behind selected TypeScript routes.

### 2.3 Existing cron jobs remain the control plane

The scheduler does not become aware of Python during the initial migration. Existing external scheduling continues to invoke the current Next.js internal endpoints at the current cadence.

### 2.4 Existing storage ownership remains intact

PostgreSQL remains the source of historical and derived application state. Redis remains the current serving/cache layer. Python receives explicit compute inputs and returns explicit compute results; it does not become the owner of DRAKON's primary persistence model during the first extraction.

### 2.5 Production and research use the same model implementation

Internal analysis, replay, calibration, sensitivity analysis, and production inference should import the same Python model modules. A notebook must not silently become a second implementation of a production equation.

### 2.6 Model identity is explicit

Every scientifically meaningful result must identify the model that produced it and the parameter/calibration context under which it was produced.

---

## 3. Current DRAKON architecture — corrected baseline

The existing architecture has **three distinct execution environments**.

```text
                                        EXTERNAL DATA
                           Space-Track / CelesTrak / NOAA / TIP
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────┐
│                         APPLICATION PLANE                           │
│                         Next.js / TypeScript                        │
│                                                                    │
│  app/api/*                    lib/*                 cron endpoints  │
│  public/internal APIs         DB/Redis              job orchestration│
└──────────────┬──────────────────────────┬──────────────────────────┘
               │                          │
               │                          └───────────────┐
               │                                          │
               ▼                                          ▼
        Redis / PostgreSQL                         DRAKON Compute Engine
                                                     Python / FastAPI
                                                            │
                                                            ▼
                                              numerical/scientific models

┌────────────────────────────────────────────────────────────────────┐
│                        BROWSER COMPUTE PLANE                        │
│                    Next.js client + Comlink Worker                  │
│                                                                    │
│  satellite.js / SGP4                                               │
│  current positions                                                 │
│  batch propagation                                                 │
│  ground tracks / orbit paths                                       │
│  interactive collision-density computation                         │
└────────────────────────────────────────────────────────────────────┘
```

The browser plane is important. `lib/workers/satellite.worker.ts` performs SGP4 propagation, ground-track/orbit-path generation, relative-velocity work, and collision-density computation in a Web Worker. `lib/satelliteWorker.ts` explicitly gates worker creation on `typeof window !== 'undefined'` and falls back to synchronous computation on the server. This is an intentional low-latency design and must not be replaced by network calls to FastAPI. fileciteturn20file0L2-L2 fileciteturn21file0L2-L2

The TLE architecture is also intentionally ingestion-first: the current catalog is assembled through internal Next.js routes and served through Redis, while PostgreSQL stores historical observations and downstream derived state. The client read path does not perform provider ingestion. fileciteturn12file0L2-L2

---

## 4. Target service topology

Vercel Services is the initial deployment model.

```text
                         One Git repository
                              DRAKON
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
          Next.js Service             Compute Service
          root: ./                    root: ./backend
          framework: nextjs            framework: FastAPI
                    │                       │
                    │ Service Binding      │
                    └──────────────────────►
                                            │
                                      private by default
```

Vercel's current Services model supports multiple frontends/backends within a single project. Each service has its own root and services can communicate through bindings; a service does not need a public rewrite to be reachable by another bound service. The calling service receives an injected URL environment variable for the target service. citeturn639927search1turn639927search4

For DRAKON the preferred relationship is:

```text
Browser
   │
   ├── /api/* ───────────────► Next.js
   │
   └── Web Worker ───────────► local JS computation

cron
   │
   ▼
Next.js /api/internal/*
   │
   ├── Redis
   ├── PostgreSQL
   ├── external providers
   │
   └── private service binding
               │
               ▼
        DRAKON Compute Engine
        FastAPI / Python
```

Nothing client-facing needs to reach FastAPI directly for the first generation of the service.

---

## 5. Vercel Services configuration

The final `vercel.json` should define the Next.js service and the Python service as separate roots. The exact service configuration should follow the Vercel Services syntax available to the project at implementation time; the current documentation uses service definitions plus a binding on the caller. citeturn639927search4turn416716view1

Conceptually:

```json
{
  "services": {
    "web": {
      "root": ".",
      "framework": "nextjs",
      "bindings": [
        {
          "type": "service",
          "service": "compute",
          "format": "url",
          "env": "BACKEND_URL"
        }
      ]
    },
    "compute": {
      "root": "backend/",
      "framework": "fastapi",
      "entrypoint": "main:app"
    }
  }
}
```

The important architectural properties are:

- `web` remains the primary Next.js service.
- `compute` has an independent root and Python dependency environment.
- `BACKEND_URL` is injected into the calling service by the binding.
- `compute` has no public rewrite in the initial design.
- `app/api/*` is still handled by Next.js.
- Vercel's internal binding handles service reachability without exposing the compute service through public traffic. A binding grants reachability; application-level authorization should still be implemented in the service. citeturn639927search4turn639927search3

Vercel's published FastAPI + Next.js example demonstrates the same multi-service model with separate roots and FastAPI entrypoint configuration. citeturn416716view1

---

## 6. Why FastAPI is an internal compute boundary, not a second public API

FastAPI provides:

- typed Pydantic request/response contracts
- a stable interface around scientific models
- model discovery/health endpoints where needed
- a natural home for Python numerical libraries
- a clean separation between HTTP concerns and model implementation

It should **not** become a second public API namespace competing with `app/api/*`.

The application-facing flow is:

```text
Client
  │
  ▼
/api/object-trends
/api/internal/process-trends
/api/... existing routes
  │
  ▼
TypeScript application logic
  │
  ▼
PythonComputeClient
  │
  ▼
private service binding
  │
  ▼
FastAPI
```

A future internal FastAPI endpoint might be `/compute/reentry`, but that path is inside the private compute service, not a new client-facing DRAKON API contract.

---

## 7. Extraction rules for existing TypeScript code

Extraction is performed by **responsibility**, not by file.

### 7.1 `lib/satelliteHelpers.ts`

Split the file. Do not port it wholesale.

#### Strong Python candidates

- orbital parameter calculations used by the re-entry model
- BSTAR parsing/interpretation when it is model input
- atmospheric proxy calculations
- decay-rate equations
- altitude-based re-entry estimation
- mathematical anomaly/sanity checks
- numerical pieces of `getReentryRisk()`

#### Keep in TypeScript

- presentation formatting such as `formatDistance()`
- UI/application helpers
- API response shaping
- provider/storage orchestration
- lightweight classification used outside a scientific model

The first Python extraction should preserve the current numerical behavior before improving the model.

### 7.2 `lib/objectTrendRisk.ts`

This file is a **first-class extraction boundary** and must not be omitted from the plan.

The most important function is:

```text
resolveReentryRisk()
```

It is the final re-entry resolution/composition point where current orbital state, trend evidence, environmental corrections, and decision policy are combined. The current implementation includes the HEO gate, altitude-path selection, raising-orbit / negative-BSTAR handling, maneuver/stability gates, trend comparison, pessimistic estimate selection, and tier boundaries. fileciteturn19file0L2-L2

The Python extraction should therefore model this explicitly as a **Re-entry Resolution Model**, not merely as another helper.

Conceptually:

```text
Current orbital state
Trend evidence
Solar flux multiplier
Geomagnetic correction/state
Model parameters
       │
       ▼
ReentryResolutionModel
       │
       ├── HEO gate
       ├── object/debris policy
       ├── low-altitude path
       ├── maneuver/raising-orbit gates
       ├── trend path
       ├── altitude path
       ├── pessimistic-of-two resolution
       └── confidence/tier resolution
       │
       ▼
ReentryResolutionResult
```

#### Specifically keep out of the Python model

`attachTipData()`, `effectiveDaysRemaining()`, and `buildReentryRiskMap()` remain application/reference-data composition. TIP remains an external reference and must not overwrite DRAKON's own estimate. fileciteturn19file0L2-L2

### 7.3 Environmental corrections

The Compute Engine should **receive environmental state; it should not own environmental acquisition**.

For example:

```json
{
  "environment": {
    "solar_flux_multiplier": 1.18,
    "geomagnetic_correction": 0.92
  }
}
```

The Next.js layer continues to own NOAA/geomagnetic acquisition, Redis caching, freshness policy, and operational scheduling. The Python model remains deterministic with respect to the supplied environmental inputs.

This allows a historical analysis to reproduce a past decision with the same environmental state that was available at that time.

### 7.4 `lib/explainReentryTrend.ts`

The model-level logic is a candidate for Python extraction:

- signal-strength calculations
- maneuver likelihood
- confidence composition
- payload consensus
- decay classification
- trend-derived re-entry estimate

But the extraction must reflect the real dependency graph. `resolveReentryRisk()` is downstream of these signals; it is not optional application glue.

### 7.5 `lib/jobs/computeObjectTrends.ts`

This file should be split between **worker orchestration** and **scientific computation**.

Keep in TypeScript:

- claiming `trend_jobs`
- `FOR UPDATE SKIP LOCKED`
- retry counters
- batch orchestration
- PostgreSQL reads
- `object_trends` persistence
- `trend_snapshots`
- job deletion/requeue
- scheduler interaction

The current worker claims a requested number of jobs and processes them in `CONCURRENCY = 10` slices using `Promise.allSettled`, deleting successful jobs immediately so partial progress survives a mid-run failure. fileciteturn18file0L2-L2

Do **not** replace that durability model with a Python-owned queue merely because trend mathematics moves to Python.

---

## 8. Regression extraction policy

The current weighted regression implementation should **remain in TypeScript initially**.

The reason is architectural discipline: a closed-form OLS/weighted-OLS kernel is mathematically simple enough that Python does not automatically provide a material benefit at the current workload. The existing trend worker's regression is not itself sufficient justification for adding a network boundary. fileciteturn18file0L2-L2

Move regression to Python when the model becomes materially more sophisticated, for example:

- robust regression
- non-linear fitting
- state-space/Kalman filtering
- uncertainty propagation
- Bayesian estimation
- Monte Carlo inference
- parameter fitting requiring SciPy
- vectorized analysis across substantially larger datasets
- the production trend model and calibration tooling genuinely need the same Python implementation

The architectural rule is:

> **Python is not the destination for all mathematics. It is the destination for mathematics whose complexity or lifecycle justifies the compute boundary.**

---

## 9. Browser computation is explicitly out of scope

The following remain in the browser worker architecture:

- current satellite position propagation
- batch position propagation
- ground-track generation
- orbit-path generation
- interactive collision-density calculation
- relative-velocity checks used by the interactive collision workflow
- Comlink worker lifecycle and browser-side caches

The reason is not that Python cannot implement them. The reason is that these computations are part of an interactive visualization loop where a network round trip would violate the reason the worker exists.

### Future server-side equivalents are allowed

A separate Python model may eventually support:

```text
historical collision analysis
catalog-wide offline density studies
large Monte Carlo conjunction experiments
server-side batch propagation
research simulations
```

Those are distinct workloads and must not replace the browser worker.

---

## 10. First Python service — minimal shape

The first implementation should deliberately be small:

```text
backend/
├── pyproject.toml
├── main.py
├── contracts.py
└── compute/
    └── reentry.py
```

Example responsibilities:

```python
# main.py
app = FastAPI()

# contracts.py
ReentryRequest
ReentryResponse

# compute/reentry.py
calculate_reentry(...)
```

Do not create an empty abstraction for every future service on day one. Expand the directory as real models are extracted.

A later architecture can grow to:

```text
backend/
├── main.py
├── contracts/
│   ├── reentry.py
│   ├── trend.py
│   └── orbit.py
├── models/
│   ├── registry.py
│   └── versions.py
├── compute/
│   ├── reentry/
│   ├── orbit/
│   ├── collision/
│   └── uncertainty/
└── analysis/
    ├── replay/
    ├── calibration/
    ├── sensitivity/
    └── benchmarks/
```

---

## 11. Compute API contract

The FastAPI boundary must use explicit request/response models.

### Example request

```json
{
  "norad_id": 12345,
  "orbital_state": {
    "perigee_km": 245.2,
    "apogee_km": 251.8,
    "mean_motion": 15.8,
    "mean_motion_dot": 0.000012
  },
  "trend": {
    "decay_signal": "decaying",
    "decay_confidence": 0.71,
    "maneuver_likelihood": 0.03,
    "estimated_days_remaining": 67
  },
  "environment": {
    "solar_flux_multiplier": 1.12,
    "geomagnetic_correction": 0.96
  }
}
```

### Example response

```json
{
  "status": "ok",
  "result": {
    "estimated_days_remaining": 61,
    "tier": "warning",
    "confidence": "medium",
    "source": "multi_epoch"
  },
  "model": {
    "id": "reentry_resolution",
    "version": "0.1.0",
    "parameter_set": "reentry-2026-09-baseline",
    "calibration_version": "cal-2026-09-01"
  }
}
```

Units must be explicit in schemas or field names. Null means unavailable/indeterminate; zero must mean a real zero.

---

## 12. Batch contract and partial success

Batch APIs are appropriate for background jobs, but the contract must support **per-object results**.

The Python service must not expose an all-or-nothing interpretation for a batch of independent objects.

Example:

```json
{
  "status": "partial",
  "model": {
    "id": "object_trend",
    "version": "4"
  },
  "results": [
    {
      "norad_id": 10001,
      "status": "ok",
      "result": { }
    },
    {
      "norad_id": 10002,
      "status": "error",
      "error": {
        "code": "NUMERICAL_FAILURE",
        "message": "...",
        "retryable": true
      }
    }
  ]
}
```

### Batch status

```text
complete  -> every item returned successfully
partial   -> at least one success and one item-level failure
failed    -> no trustworthy item result was returned
```

### Item status

```text
ok
error
```

Every item error must identify whether retrying is meaningful.

### Reconciliation in the TypeScript worker

```text
Python response
       │
       ├── item OK
       │     └── persist result + delete job
       │
       └── item ERROR
             ├── retryable    -> increment retry + pending
             └── non-retryable -> record/drop according to policy
```

A **transport/service failure** is different:

```text
HTTP 500 / timeout / no valid response
       ↓
whole compute batch is unresolved
       ↓
requeue the corresponding jobs
```

The worker must never increment retry counters for objects already successfully acknowledged in a valid partial response.

---

## 13. Deadline budgeting around the existing 60-second envelope

The current internal routes already declare a 60-second `maxDuration`, including `process-trends`, `ingest-tle`, and partition maintenance. fileciteturn23file0L2-L2 fileciteturn24file0L2-L2 fileciteturn25file0L2-L2

The Python boundary must therefore be treated as part of the existing execution budget, not as an additional unlimited phase.

### Initial engineering budget

Use a soft orchestration deadline below the platform ceiling rather than attempting to run to the final second.

```text
60 s hard outer limit
│
├── ~5 s safety margin
├── DB claim/read overhead
├── Python network + compute
├── DB persistence
└── response/cleanup
```

The initial implementation should use a **soft deadline around 45–50 seconds**, then tune it from production measurements. The document intentionally does not define a permanent milliseconds-per-object target because the correct budget depends on payload size, model implementation, batch size, and service runtime.

### Deadline propagation

Before each Python call, the TypeScript worker should calculate the remaining orchestration budget.

```text
remaining = soft_deadline - now

python_timeout = min(
    configured_compute_timeout,
    remaining - persistence_reserve
)
```

If the remaining budget is too small:

```text
stop claiming new work
finish/persist anything already safely completed
requeue unresolved work
return
```

### Outer-function termination

The architecture must explicitly account for the case where the Vercel function approaches 60 seconds while a Python call is in flight.

Do not assume the Python computation will complete after the outer function is terminated. The TypeScript worker must treat the invocation as successfully processing only the jobs whose results were durably acknowledged and persisted before the outer deadline.

Idempotent persistence and retryable jobs make duplicate computation safe.

---

## 14. Batch sizing strategy

The existing `process-trends` route accepts a batch size of 200, while the worker internally processes claimed jobs in concurrency slices of 10. fileciteturn23file0L2-L2 fileciteturn18file0L2-L2

Do not automatically turn 200 jobs into one giant HTTP request.

Instead:

```text
scheduler
   ↓
claim up to 200 durable jobs
   ↓
choose compute request size from benchmarked limit
   ↓
submit compute batch
   ↓
reconcile per-item results
   ↓
repeat while deadline allows
```

The first production batch size should be measured. A small request such as 10–25 objects is a reasonable starting experiment, not a permanent design constant.

The key requirement is that the worker's **durable batch** and the compute service's **transport batch** are separate concepts.

---

## 15. Cron-driven pipeline non-disruption

The extraction must not migrate scheduler ownership.

Current cron-driven endpoints remain unchanged:

```text
POST /api/internal/ingest-tle
POST /api/internal/process-trends
POST /api/internal/manage-tle-partitions
POST /api/internal/requeue-stale
POST /api/internal/geomagnetic-shadow
POST /api/internal/geomagnetic-shadow/replay
...
```

The current documentation describes external scheduling for hourly TLE ingestion, a 15-minute trend worker, partition maintenance, daily solar-flux refresh, and hourly geomagnetic/shadow refresh. fileciteturn13file0L8-L25

### Required invariants

- Do not change cron cadence during compute extraction.
- Do not rename existing cron endpoints.
- Do not move provider acquisition into Python.
- Do not move Redis locks into Python.
- Do not move PostgreSQL queue claiming into Python.
- Do not move partition maintenance into Python.
- Do not make TLE ingestion depend synchronously on Python.
- A Python outage must not corrupt the current TLE snapshot.
- A Python outage during trend processing must leave work retryable.

### Ingestion remains independent

`/api/internal/ingest-tle` continues to execute the existing ingestion lifecycle. The Python service is not part of that pipeline unless a future, separately reviewed model genuinely needs to participate.

The current ingestion route already has its own `maxDuration = 60` and calls `runIngestionCycle()` directly. fileciteturn24file0L2-L2

The first extraction must therefore leave that route and service untouched.

---

## 16. Trend-worker integration after Python extraction

The intended end state is:

```text
cron-job.org
     │
     ▼
POST /api/internal/process-trends
     │
     ▼
processTrendJobs()
     │
     ├── claim jobs
     ├── read history from PostgreSQL
     ├── construct compute inputs
     ├── call FastAPI batch endpoint
     ├── reconcile per-item results
     ├── persist successful trends
     └── requeue failed items
```

The existing `trend_jobs` queue remains the recovery mechanism. Python does not need to know whether a job is pending or processing.

The current worker intentionally persists progress after each concurrency slice so an interrupted batch does not erase already-completed work. That property must remain after extraction. fileciteturn18file0L2-L2

---

## 17. Model versioning

Model versioning is separate from service/API versioning.

### 17.1 Required metadata

Each model result should expose:

```text
model_id
model_version
parameter_set_id
calibration_version
engine_version
```

Example:

```text
model_id             = reentry_resolution
model_version        = 0.2.0
parameter_set_id     = reentry-2026-09-baseline
calibration_version  = cal-2026-09-01
engine_version       = 0.1.0
```

### 17.2 Existing `trendVersion`

The current trend implementation uses `CURRENT_TREND_VERSION = 4`. This should not be discarded. It should become the compatibility bridge to a more explicit model identity system. fileciteturn18file0L2-L2

For example:

```text
legacy trendVersion = 4

new metadata:
trend_model_id      = object_trend
trend_model_version = 4
```

### 17.3 Versioning rules

- **Patch:** implementation fix without intentional model-behavior change.
- **Minor:** new component/parameterization within the same conceptual model.
- **Major:** methodology or interpretation change that is materially incompatible.

Any change expected to alter scientific outputs must cause a model-version decision, even if the API schema remains unchanged.

### 17.4 Result provenance

A persisted derived result should eventually be traceable to:

```text
input data / observation window
model version
parameter set
environment state
calibration version
compute-engine version
```

This is essential when historical outputs need to be explained or recomputed.

---

## 18. Re-entry model architecture

The first Python model should represent the current DRAKON re-entry behavior rather than invent a new model during migration.

### 18.1 Inputs

```text
TLE-derived orbital state
Object type/debris policy
Multi-epoch trend evidence
Solar flux multiplier
Geomagnetic correction/state
Current evaluation time
Model parameter set
```

### 18.2 Internal stages

```text
1. Validate input
2. Establish orbital regime
3. Apply HEO gate
4. Apply raising-orbit / contradictory-signal gates
5. Determine debris/payload path
6. Evaluate low-altitude path
7. Evaluate trend path
8. Calculate candidate estimates
9. Apply pessimistic-of-two selection where applicable
10. Apply confidence ceiling/tier boundaries
11. Emit result + diagnostics + model metadata
```

This reflects the current `resolveReentryRisk()` role rather than treating the function as an unimportant wrapper. fileciteturn19file0L2-L2

### 18.3 Diagnostics

The model should expose intermediate diagnostics sufficient to support DRAKON's decision-trace UI and internal validation, for example:

```text
selected_path
candidate_estimates
hee/heo_gate_result
maneuver_gate_result
environment_adjustment
confidence
raw_tier
final_tier
```

Diagnostics must be machine-readable rather than reconstructed from UI strings.

---

## 19. Testing architecture

Scientific migration needs multiple layers of validation.

### 19.1 Python unit tests

Pure functions should cover:

- TLE numerical parsing
- orbital equations
- BSTAR decoding
- decay-rate equations
- environmental multipliers/corrections
- signal calculations
- confidence calculations
- tier boundaries
- decision gates

### 19.2 Numerical invariants

Examples:

```text
perigee <= apogee
R² ∈ [0, 1]
confidence ∈ [0, 1]
probability-like scores ∈ [0, 1]
invalid orbital inputs fail explicitly
```

### 19.3 Golden fixtures

Build deterministic cases for:

- stable debris
- decaying debris
- low-altitude terminal object
- maneuvering payload
- stable payload
- HEO object
- negative-BSTAR / raising-orbit case
- contradictory trend case
- environmental correction case
- insufficient history

### 19.4 TypeScript/Python parity

During migration, run the current TypeScript model and Python model against the same fixture set.

```text
same input
   ├── TypeScript implementation
   └── Python implementation
             ↓
        compare outputs
```

Numerical fields use tolerances. Categorical states and gate outcomes should match exactly.

### 19.5 Contract tests

Verify:

- request schema compatibility
- response schema compatibility
- null semantics
- units
- model metadata presence
- per-item batch status

### 19.6 Integration tests

Test:

```text
Next.js route
   ↓
Python binding
   ↓
FastAPI
   ↓
model
   ↓
response
   ↓
Next.js persistence
```

### 19.7 Performance tests

Benchmark before changing production authority:

```text
Python cold-start latency
warm-request latency
batch latency
objects/sec
memory
serialization time
TypeScript orchestration overhead
```

Do not assume Python is faster without measuring the actual end-to-end workload.

---

## 20. Shadow and rollout strategy

Shadow mode is valuable for **behavior verification**, not as a permanent governance layer.

### Stage 1 — legacy authoritative

```text
TypeScript → production result
Python     → shadow comparison
```

Compare:

- estimated days
- decay rate
- tier
- confidence
- gate outcomes
- selected path

### Stage 2 — canary authority

A controlled subset of compute calls uses Python as authoritative while the TypeScript implementation remains available as a fallback/diagnostic path.

### Stage 3 — Python authority

Once disagreement, reliability, latency, and data-quality behavior are acceptable:

```text
Python → authoritative
TypeScript → removed only after migration confidence
```

Do not combine the initial language migration with a simultaneous scientific redesign.

---

## 21. Failure isolation and fallback

### Python unavailable

For an interactive/application request where a safe TypeScript implementation still exists:

```text
Python timeout/error
      ↓
TypeScript fallback if explicitly supported
```

For a background trend job:

```text
Python timeout/error
      ↓
requeue affected job(s)
```

For TLE ingestion:

```text
Python unavailable
      ↓
TLE ingestion continues
```

There must be no silent conversion such as:

```text
Python model error → stable
```

unless `stable` is the actual scientifically derived result.

### Compute result validation

Next.js should validate at minimum:

- schema
- NORAD ID correspondence
- model ID
- expected model version
- enum validity
- required fields
- numerical finiteness

A response that cannot be trusted should not be persisted merely because the HTTP request succeeded.

---

## 22. Database and Redis ownership

The initial boundary is:

```text
Next.js
   │
   ├── PostgreSQL reads
   ├── Redis reads
   └── application state
          │
          ▼
       Python
          │
          ▼
       result
          │
          ▼
Next.js
   │
   └── PostgreSQL write
```

Python does not initially own:

- `trend_jobs`
- `object_trends`
- `trend_snapshots`
- `tle_history`
- `tle_archive`
- Redis cache keys
- ingestion locks
- partition lifecycle

A future compute service may gain direct database access if scale or architecture proves that beneficial. That is a separate design decision.

---

## 23. Internal analysis and calibration

The Python service should be reusable without FastAPI.

### Production path

```text
FastAPI endpoint
    ↓
model function
```

### Analysis path

```text
analysis script/notebook
    ↓
same model function
```

### Calibration path

```text
historical dataset
       ↓
replay
       ↓
parameter sweep / sensitivity
       ↓
candidate parameter set
       ↓
validation dataset
       ↓
approved calibration version
```

A calibration run should record:

```text
model_id
model_version
parameter_set_id
calibration_version
dataset identifier
run timestamp
random seed, when relevant
engine version
```

DRAKON already has calibration/research material in the repository. The Compute Engine should become the reusable home for future calibration work rather than creating more isolated one-off scripts.

---

## 24. Analysis datasets and reproducibility

Small deterministic fixtures belong in Git.

Large historical datasets should not be bundled into the FastAPI deployment package. Use a versioned external/object-storage location when the analysis corpus becomes too large for the repository.

An analysis should be reproducible from:

```text
dataset version
model version
parameter set
calibration version
environment inputs
code/engine version
```

---

## 25. Future Python services

Future server-side services should be introduced only when justified by workload characteristics.

### Good candidates

```text
/compute/reentry
/compute/orbit-state
/compute/orbit-propagate
/compute/collision-analysis
/compute/uncertainty
/compute/simulation
```

### Not automatic extraction targets

```text
browser SGP4 propagation
browser ground tracks
browser orbit paths
browser collision-density interaction
Comlink worker lifecycle
React/UI calculations
```

The same scientific capability may legitimately exist twice when the workloads differ:

```text
interactive browser propagation  → TypeScript worker
large offline propagation       → Python Compute Engine
```

This is intentional duplication at the execution layer, not duplication of a single application API.

---

## 26. Server-side collision/orbital work — when Python becomes appropriate

Python becomes compelling for orbital/collision work when the workload is no longer an interactive globe loop.

Examples:

```text
15,000 objects × thousands of time steps
large historical replay
Monte Carlo conjunction analysis
parameter sensitivity studies
multi-object batch propagation
```

At that point:

```text
Next.js job orchestration
      ↓
Python batch compute
      ↓
vectorized/native numerical implementation
```

is preferable to shipping the workload through the browser or making thousands of HTTP calls.

---

## 27. Deployment evolution

The deployment strategy is intentionally **Vercel-first**.

### Initial state

```text
One Vercel project
├── Next.js Service
└── FastAPI Compute Service
```

Both services share the repository and deployment system. Vercel documents this as a supported Services pattern; service bindings are deployment-aware and provide private service-to-service connectivity. citeturn639927search4

### Later hosting evolution

If a future workload exceeds the practical characteristics of a Vercel request/Function—for example, long-running simulations, persistent workers, or extremely large batch processing—the **hosting boundary** can change without redesigning the Python model API:

```text
FastAPI code
    │
    ├── Vercel Service today
    │
    └── container/service later
```

The migration should therefore avoid Vercel-specific assumptions inside `compute/*.py`.

The future move is a deployment/configuration concern, not a scientific-model rewrite.

---

## 28. Operational observability

Every production compute call should be observable without logging full scientific payloads by default.

Recommended metadata:

```text
request_id
model_id
model_version
parameter_set_id
engine_version
item_count
execution_ms
status
```

Recommended metrics:

```text
compute_requests_total
compute_failures_total
compute_timeouts_total
compute_duration_ms
compute_items_processed
compute_items_failed
model_disagreements_total
```

For background processing, the existing job metrics remain the source of truth for whether work is completing.

---

## 29. Security

The FastAPI service is an internal compute service.

- No public rewrite is required in the initial architecture.
- The browser must not be given the internal service URL.
- The service binding provides reachability, not application-level authorization; the compute service should still verify an internal caller credential/header or equivalent application-level control. citeturn639927search4turn639927search3
- Provider secrets remain with the Next.js service unless a model explicitly requires a provider API and that ownership is deliberately moved later.
- Calibration/analysis endpoints must not become public application APIs by accident.

---

## 30. CI/CD

The repository should test both application and Python services.

```text
TypeScript lint/test
        │
        ├──────────────┐
        │              │
Python test suite     │
        │              │
        └──────┬───────┘
               ▼
       contract/parity tests
               │
               ▼
          deployment build
```

The first phase should not require every analysis notebook to pass as part of the web deployment. Production tests and research tooling should remain related but independently runnable.

The Python dependency lock/configuration must be committed with the service so deploys are reproducible.

---

## 31. Migration plan — start to finish

### Phase 0 — Architecture freeze

Document:

- service boundaries
- current cron endpoints
- current job semantics
- browser worker ownership
- Python candidate functions

Do not change production computation.

### Phase 1 — Create the Compute Engine

Add:

```text
backend/
├── pyproject.toml
├── main.py
├── contracts.py
└── compute/
```

Add only the minimum FastAPI/Pydantic/scientific dependencies needed by the first model.

Expose a health endpoint.

### Phase 2 — Add Vercel Service wiring

Introduce the `backend` Vercel Service and a binding from the Next.js service.

Verify:

```text
Next.js can reach FastAPI privately
FastAPI is not client-facing
/api/* still resolves to Next.js
existing cron endpoints still execute normally
```

Use `vercel dev` / local Services development to exercise the two-service topology before production. Vercel documents local multi-service development for Services. citeturn639927search1

### Phase 3 — Extract re-entry numerical primitives

Port the smallest pure numerical functions first.

Do not change formulas during this phase.

### Phase 4 — Reconstruct the re-entry resolution model

Port the model-level responsibilities spanning:

```text
satelliteHelpers.ts
explainReentryTrend.ts
objectTrendRisk.ts
reentrySignals.ts
```

with `resolveReentryRisk()` represented explicitly as the composition/resolution model.

### Phase 5 — Build parity suite

Run TypeScript and Python against the same golden dataset.

No production authority change yet.

### Phase 6 — Introduce the Next.js compute client

Create a small TypeScript adapter responsible only for:

- building request payloads
- applying request deadlines
- calling `BACKEND_URL`
- validating response envelopes
- exposing typed errors

It should not contain scientific formulas.

### Phase 7 — Shadow execution

Production TypeScript result remains authoritative. Python calculates the parallel result and records disagreement/latency telemetry.

### Phase 8 — Canary

Make Python authoritative for a controlled subset of requests while retaining an explicit legacy fallback.

### Phase 9 — Full re-entry authority

Switch the production path to Python once:

- parity is proven
- error rates are acceptable
- latency fits the caller's budget
- model metadata is persisted/observable
- rollback is verified

### Phase 10 — Decide whether trend mathematics should move

Do not automatically migrate OLS.

Move only the parts whose complexity or analysis lifecycle now justifies Python.

### Phase 11 — Future compute services

Introduce server-side orbit/collision/uncertainty services as independent model families when their workloads justify them.

---

## 32. Rollback strategy

Every migration phase must be reversible.

### Service-level rollback

If the Python service fails:

```text
Python disabled
    ↓
TypeScript path becomes authoritative
```

### Model-level rollback

If a new model version produces unacceptable output:

```text
model registry
   ↓
previous version restored
```

### Deployment-level rollback

Vercel deployment rollback remains available without changing the repository architecture.

Do not rewrite historical data just because a new model version is rejected. Historical results and model versions should remain auditable.

---

## 33. Definition of done — first extraction

The first Python production extraction is complete when:

### Architecture

- [ ] Next.js App Router remains unchanged at the API namespace level.
- [ ] `app/api/*` remains 100% TypeScript.
- [ ] `backend/` is a separate FastAPI service root.
- [ ] Vercel Services binding works locally and in production.
- [ ] Python is not client-facing.

### Scientific correctness

- [ ] `resolveReentryRisk()` behavior is represented explicitly in the Python model.
- [ ] solar-flux and geomagnetic inputs are explicit model inputs.
- [ ] HEO and maneuver/raising-orbit gates are covered.
- [ ] pessimistic-of-two resolution is covered.
- [ ] tier boundaries are tested.
- [ ] TypeScript/Python parity is established.

### Operations

- [ ] Existing cron cadence is unchanged.
- [ ] TLE ingestion does not depend on Python.
- [ ] `trend_jobs` ownership remains in PostgreSQL/TypeScript.
- [ ] Partial batch responses reconcile per object.
- [ ] Python calls obey an outer deadline budget.
- [ ] Python outages are retryable/isolated.

### Governance

- [ ] model ID/version exists.
- [ ] parameter/calibration version exists.
- [ ] result provenance is observable.
- [ ] rollback is tested.

---

## 34. Long-term architecture

```text
                           DRAKON
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
 Browser Compute       Application Plane      Compute Plane
 TypeScript Workers    Next.js / TypeScript   Python / FastAPI
         │                    │                    │
         │                    ├── API routes       ├── Re-entry
         │                    ├── Providers       ├── Orbital models
         │                    ├── Redis           ├── Collision analysis
         │                    ├── PostgreSQL      ├── Uncertainty
         │                    └── Cron jobs       ├── Simulation
         │                                         └── Calibration
         │
         ├── SGP4
         ├── interactive density
         ├── tracks
         └── real-time visualization
```

The desired end state is not "Python everywhere." It is **clear placement of computation according to its execution characteristics**.

The resulting architecture should allow DRAKON to grow from its current re-entry screening system into a broader orbital decision-intelligence platform without forcing a rewrite of the parts that already work.

---

## 35. Final architectural rules

1. **`app/api/*` stays TypeScript.**
2. **Browser real-time computation stays in Web Workers.**
3. **Python is for server-side scientific computation, not every function that contains arithmetic.**
4. **`resolveReentryRisk()` is a first-class re-entry model boundary.**
5. **Environmental acquisition remains outside the model; environmental state is passed in explicitly.**
6. **The current cron system remains the orchestration control plane.**
7. **PostgreSQL/Redis ownership remains in TypeScript initially.**
8. **Durable job state remains outside FastAPI.**
9. **Batch APIs must support partial success with per-object status/error.**
10. **Outer function deadlines must include the Python network/compute hop.**
11. **Model version is distinct from API/service version.**
12. **Production and calibration use the same Python model implementation.**
13. **Vercel Services is the initial deployment; future hosting changes must not require model rewrites.**
14. **Scientific behavior changes require explicit model/version decisions.**

---

## 36. References

Repository architecture references reviewed for this plan:

- `lib/objectTrendRisk.ts` — authoritative re-entry resolution/composition path.
- `lib/satelliteHelpers.ts` — current re-entry and orbital numerical primitives.
- `lib/explainReentryTrend.ts` — trend signal/confidence/model logic.
- `lib/jobs/computeObjectTrends.ts` — durable trend-worker orchestration and current regression implementation.
- `lib/workers/satellite.worker.ts` — browser-side SGP4/collision computation.
- `lib/satelliteWorker.ts` — Comlink/browser-worker lifecycle and server fallback.
- `app/api/internal/process-trends/route.ts` — existing 60-second trend-worker boundary.
- `app/api/internal/ingest-tle/route.ts` — existing 60-second TLE ingestion boundary.
- `app/api/internal/manage-tle-partitions/route.ts` — existing 60-second partition-maintenance boundary.
- `docs/TLE_PIPELINE_ARCHITECTURE.md` — current ingestion invariants and storage architecture.
- `docs/REENTRY_RISK.md` — current re-entry model architecture and limitations.

Current Vercel references:

- Vercel Services overview: https://vercel.com/docs/services
- Services routing and communication: https://vercel.com/docs/services/routing
- Complete Guide to Vercel Services: https://vercel.com/kb/guide/vercel-services
- Next.js + FastAPI Services example: https://vercel.com/templates/fast-api/next-js-fastapi-starter

Vercel currently documents Services as a multi-service project model for frontends/backends, with separate service roots, service-to-service bindings, and per-service runtime settings. citeturn639927search1turn639927search0turn639927search4
