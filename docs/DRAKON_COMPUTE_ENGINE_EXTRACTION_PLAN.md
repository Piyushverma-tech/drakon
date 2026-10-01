# DRAKON Compute Engine — Python/FastAPI Extraction & Architecture Plan

**Status:** Proposed architecture  
**Baseline reviewed:** `bf12871c7e712ac5a555bd354c879044406d8336`  
**Document revision:** 3  
**Scope:** Introduce Python + FastAPI as a private server-side scientific compute service inside the existing DRAKON repository, while preserving the existing Next.js API surface, browser-side real-time computation, Redis/PostgreSQL ownership, and cron-driven operational pipelines.

---

## 1. Executive decision

DRAKON should evolve into a **three-plane system**:

1. **Browser Compute Plane** — existing TypeScript/Web Worker computation for interactive globe workloads. This remains local to the browser.
2. **Application Plane** — existing Next.js + TypeScript application. It owns `/api/*`, providers, Redis, PostgreSQL, cron orchestration, durable job claiming, persistence, and application-facing responses.
3. **DRAKON Compute Engine** — new Python + FastAPI service for server-side scientific models, mathematically heavy algorithms, simulation, calibration, replay, and internal analysis.

The initial deployment will use **Vercel Services** in the same repository and Vercel project:

```text
drakon/
├── app/                         # Next.js App Router — unchanged
│   └── api/                     # 100% TypeScript; owns /api/*
│
├── lib/                         # Existing TypeScript domain/application code
│
├── backend/                     # NEW — DRAKON Compute Engine
│   ├── pyproject.toml           # Python service dependencies/config
│   ├── main.py                 # FastAPI application entrypoint
│   ├── contracts.py             # Pydantic request/response contracts
│   └── compute/
│       ├── reentry.py           # first production model family
│       ├── orbit.py              # future server-side orbital models
│       └── ...
│
├── vercel.json                  # Services + routing + binding
├── package.json
└── ...
```

The Next.js service remains the public application surface. The FastAPI service remains **private** and is reached only from server-side Next.js code through a Vercel Service Binding. The browser never calls Python directly for the first generation of the Compute Engine.

The goal is **not** to rewrite DRAKON in Python. The goal is to establish a durable scientific boundary without disturbing the parts of DRAKON that already work.

---

## 2. Architectural principles

### 2.1 Computation follows workload characteristics

Not every calculation should move to Python.

A workload remains in the browser when interactive latency is part of the product experience. A workload remains in TypeScript when it is primarily application orchestration, persistence, integration, or presentation. A workload moves to Python when its scientific complexity, numerical ecosystem, server-side batch characteristics, analysis lifecycle, or independent compute requirements justify the boundary.

### 2.2 `/api/*` remains 100% TypeScript

The existing Next.js App Router API surface does not migrate to FastAPI.

```text
/api/tle
/api/tip
/api/object-trends
/api/solar-flux
/api/internal/ingest-tle
/api/internal/process-trends
...
```

continue to be owned by Next.js.

FastAPI endpoints such as `/compute/reentry` are **private service-internal routes**, not new public DRAKON API endpoints.

### 2.3 Cron remains the control plane

The existing scheduler continues to call the current Next.js internal routes. The scheduler does not call FastAPI directly.

Python is inserted behind selected application/job boundaries, not above them.

### 2.4 Storage remains an application concern initially

Redis and PostgreSQL remain owned by the TypeScript application. Python receives explicit inputs and returns explicit outputs.

Python does not initially own:

- PostgreSQL schemas
- Redis keys
- ingestion locks
- `trend_jobs`
- object persistence
- partition lifecycle
- provider sessions

### 2.5 Production and research share the same model implementation

Production endpoints and internal analysis tooling must import the same Python model functions. A notebook or calibration script must not become a second, silently divergent implementation.

### 2.6 Scientific results carry provenance

Every production model result must identify at least:

```text
model_id
model_version
parameter_set_id
calibration_version
engine_version
```

---

## 3. Current DRAKON architecture — execution boundaries

The current DRAKON system contains three distinct execution environments.

```text
                                EXTERNAL DATA
                    Space-Track / CelesTrak / NOAA / TIP
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────┐
│                       APPLICATION PLANE                            │
│                       Next.js / TypeScript                         │
│                                                                   │
│  /api/*          providers       Redis       PostgreSQL            │
│  cron routes     orchestration   cache      historical state       │
│  job workers     persistence     locks      derived state          │
└───────────────┬───────────────────────────────┬───────────────────┘
                │                               │
                │                               │ private binding
                │                               ▼
                │                    ┌─────────────────────────────┐
                │                    │   DRAKON Compute Engine      │
                │                    │   Python / FastAPI           │
                │                    │                             │
                │                    │   re-entry                  │
                │                    │   scientific models         │
                │                    │   simulation / calibration  │
                │                    └─────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│                       BROWSER COMPUTE PLANE                         │
│                   Next.js client + Comlink Worker                  │
│                                                                   │
│  satellite.js / SGP4                                               │
│  current positions                                                 │
│  batch propagation                                                 │
│  ground tracks / orbit paths                                       │
│  interactive collision-density computation                         │
└───────────────────────────────────────────────────────────────────┘
```

The browser plane is intentionally local. `lib/workers/satellite.worker.ts` handles SGP4 propagation and interactive orbital/collision calculations, while `lib/satelliteWorker.ts` gates Web Worker creation on `typeof window !== 'undefined'`. This is a latency-sensitive execution path and must remain local to the browser.

The Compute Engine is therefore **not a replacement for the browser worker**. It is a new server-side execution plane for a different class of workload.

---

## 4. Target Vercel service topology

Vercel Services is the initial deployment model.

```text
                         One Git repository
                              DRAKON
                                │
               ┌────────────────┴─────────────────┐
               │                                  │
               ▼                                  ▼
       Next.js Service                      Compute Service
       root: ./                             root: ./backend/
       framework: nextjs                    framework: fastapi
               │                                  │
               │ Service Binding                  │
               └─────────────────────────────────►
                                                  │
                                           private by default
```

The public routing model is deliberately asymmetric:

```text
Internet
   │
   ▼
 /(.*)
   │
   ▼
Next.js service
   │
   ├── /api/*
   ├── /dashboard/*
   └── application routes

Next.js server-side code
   │
   └── BACKEND_URL  ──service binding──► FastAPI
                                      (no public rewrite)
```

Vercel Services are available in **Beta on all plans**. The target architecture uses the current `services` configuration model. The older `experimentalServices` model is legacy migration documentation and is not the architecture defined here.

---

## 5. `vercel.json` — required topology

The Services configuration must include both the service definitions **and** a top-level public rewrite for the Next.js service.

A Service Binding only grants the caller access to the target service. It does not expose the caller itself to the internet. Therefore, omitting the public rewrite would leave the deployment with no public application route.

The intended configuration is:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
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
      "entrypoint": "main:app",
      "functions": {
        "**/*.py": {
          "maxDuration": 60
        }
      }
    }
  },
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": {
        "service": "web"
      }
    }
  ]
}
```

### 5.1 Why the top-level rewrite is mandatory

When `services` is present, public routing is defined by the deployment-level `rewrites` table. Services are internal by default and receive public traffic only when a top-level rewrite routes a request to them.

For DRAKON:

```text
/(.*) → web
```

makes the Next.js application public.

There is intentionally **no**:

```text
/compute/* → compute
```

rewrite. The Python service is internal-only.

### 5.2 Why `framework`, `functions`, and other runtime configuration belong inside services

Each service is configured as an independent application. When `services` is present, service-specific build/runtime settings belong to the relevant service definition rather than being treated as global application settings.

### 5.3 Project-level prerequisite

The Vercel project must be configured to build as **Services** and the repository must contain more than one service. The repository configuration and Vercel project setting must agree before deployment is treated as valid.

---

## 6. FastAPI service boundary

`backend/main.py` is the FastAPI application entrypoint.

The first version should remain deliberately small:

```text
backend/
├── pyproject.toml
├── main.py
├── contracts.py
└── compute/
    └── reentry.py
```

The service should expose internal routes such as:

```text
GET  /health
GET  /models
POST /compute/reentry
POST /compute/reentry/batch
```

The route layer should remain thin:

```text
HTTP request
    ↓
Pydantic validation
    ↓
model function
    ↓
Pydantic response
```

Scientific logic should not be embedded in route handlers.

---

## 7. Next.js-to-Python communication

Selected Next.js server-side code will use the binding-provided `BACKEND_URL`.

Example pattern:

```text
process-trends route
        │
        ▼
PythonComputeClient
        │
        ▼
new URL('/compute/trends', process.env.BACKEND_URL)
        │
        ▼
FastAPI service
```

The Python service URL must not be hard-coded.

The Service Binding is deployment-aware, so preview/staging calls resolve to the corresponding compute service for that deployment rather than requiring a manually managed hostname.

The binding provides reachability, not application-level authentication. The Compute Engine should still validate an internal authorization token/header or equivalent application-level credential.

---

## 8. What belongs in Python

The extraction is based on **model responsibility**, not on whether a file contains arithmetic.

### 8.1 `lib/satelliteHelpers.ts`

Split the file rather than porting it wholesale.

#### Strong Python candidates

- orbital-parameter calculations that are part of the re-entry model
- BSTAR interpretation
- atmospheric/drag proxies
- decay-rate equations
- altitude-based re-entry estimation
- mathematical anomaly/plausibility checks
- numerical portions of `getReentryRisk()`

#### Keep in TypeScript

- formatting helpers
- UI labels
- response shaping
- provider/storage orchestration
- application-specific mapping

### 8.2 `lib/objectTrendRisk.ts`

This is a **first-class model boundary**.

The key function is:

```text
resolveReentryRisk()
```

This is where the model's evidence and decision policy are composed. The Python representation should explicitly preserve:

- solar-flux contribution
- geomagnetic correction/state
- HEO gates
- maneuver/raising-orbit gates
- low-altitude path
- trend path
- candidate estimate comparison
- pessimistic-of-two resolution
- confidence boundaries
- tier boundaries

The Python implementation should be named and treated as the **Re-entry Resolution Model**, not as an incidental helper.

Application/reference composition remains in TypeScript, including TIP attachment and display mapping.

### 8.3 Environmental state

Python must receive environmental state rather than fetch it.

Conceptually:

```json
{
  "environment": {
    "solar_flux_multiplier": 1.18,
    "geomagnetic_correction": 0.92
  }
}
```

Next.js continues to own:

- NOAA/geomagnetic acquisition
- Redis caching
- freshness policy
- external scheduling
- provider failures

This keeps the model deterministic and replayable.

### 8.4 `lib/explainReentryTrend.ts`

Move model-level signal composition when it is part of the re-entry model:

- signal strength
- confidence composition
- maneuver likelihood
- decay classification
- re-entry estimate logic
- consensus rules

The extraction must preserve the dependency relationship with `resolveReentryRisk()`.

---

## 9. What stays in TypeScript

The following are explicitly **not** part of the first Python extraction:

```text
Next.js UI
Next.js app/api routes
provider integrations
Space-Track sessions
CelesTrak adapters
NOAA acquisition
Redis access
PostgreSQL/Drizzle
cron orchestration
trend_jobs ownership
job claiming
job retry semantics
job persistence
partition management
TIP storage/reference composition
application formatting
```

These responsibilities remain in the Application Plane.

---

## 10. Browser computation is explicitly out of scope

The following remain in the TypeScript/Web Worker architecture:

- SGP4 propagation used by the interactive globe
- batch satellite position propagation for visualization
- ground-track generation
- orbit-path generation
- interactive collision-density computation
- Comlink worker lifecycle
- browser-side worker caching/fallback behavior

A server-side Python implementation may later exist for a **different workload**:

```text
interactive globe
    → browser worker

large historical analysis
    → Python Compute Engine
```

This is intentional execution-level specialization, not accidental duplication.

---

## 11. Trend regression policy

The existing OLS/weighted-OLS implementation should remain in TypeScript initially.

A closed-form regression is not sufficient justification for introducing a network hop. At the current workload, Python does not automatically make this calculation meaningfully faster or more maintainable.

Move trend mathematics when the model becomes materially more sophisticated or its research lifecycle benefits from Python, for example:

- robust regression
- non-linear fitting
- state-space/Kalman models
- uncertainty propagation
- Bayesian estimation
- Monte Carlo inference
- SciPy-based parameter fitting
- substantially larger vectorized workloads

The threshold is **material benefit**, not "contains equations."

---

## 12. Trend-worker integration

The existing trend worker remains the durable queue owner.

The current architecture claims jobs from `trend_jobs`, processes them in concurrency slices, and persists/deletes successful work so partial progress survives failures. That behavior must remain intact after Python is introduced.

The target flow is:

```text
cron
  ↓
POST /api/internal/process-trends
  ↓
processTrendJobs()
  ↓
claim durable jobs
  ↓
read historical records
  ↓
construct compute request
  ↓
FastAPI batch endpoint
  ↓
reconcile per-item results
  ↓
Persist successful objects
  ↓
Delete successful jobs
  ↓
Requeue failed objects
```

Python never owns the durable job state during the first extraction.

---

## 13. Partial-batch contract

A compute batch must support independent success/failure for each object.

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
      "result": {}
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

### Batch-level status

```text
complete = all items succeeded
partial  = some succeeded, some failed
failed   = no trustworthy item result returned
```

### Item-level status

```text
ok
error
```

### Reconciliation rule

```text
item = ok
    → persist result
    → delete corresponding job

item = error + retryable
    → increment retry metadata
    → leave/requeue job pending

item = error + non-retryable
    → record failure according to worker policy
    → do not blindly retry
```

A transport failure is different:

```text
Python timeout / HTTP 5xx / no valid response
    ↓
whole submitted compute batch is unresolved
    ↓
requeue corresponding unresolved jobs
```

A valid partial response must never cause successful objects to be retried merely because another object failed.

Persistence should remain idempotent so a transport-level retry cannot corrupt derived state.

---

## 14. Execution-deadline budget

DRAKON's existing Next.js cron routes intentionally use a 60-second execution cap.

This is a **DRAKON operational choice**, not the current Vercel Hobby platform maximum. Current Fluid Compute defaults are approximately 300 seconds on Hobby, with higher plan-specific limits available. DRAKON should nevertheless retain 60 seconds initially for predictability, cost control, and compatibility with the existing worker design.

The Python service should also be explicitly configured for:

```json
"functions": {
  "**/*.py": {
    "maxDuration": 60
  }
}
```

inside the `compute` service.

### 14.1 Initial soft budget

Do not target the entire 60 seconds.

Use an initial soft orchestration deadline of roughly:

```text
45–50 seconds
```

with the remainder reserved for:

- final database writes
- job reconciliation
- cleanup
- response generation
- unexpected latency

The exact budget should be tuned from measured production behavior.

### 14.2 Deadline propagation

Before each Python call:

```text
remaining = soft_deadline - now

python_timeout = min(
    configured_compute_timeout,
    remaining - persistence_reserve
)
```

If there is insufficient time for another compute/persist cycle:

```text
stop claiming new jobs
finish only work that can be safely committed
requeue unresolved work
return
```

### 14.3 Outer-function termination while Python is running

If the Next.js/Vercel function is approaching its own deadline while a Python request is in flight, the outer function must not assume Python will continue the work on its behalf.

Only results that were received, validated, and durably persisted count as completed.

Everything else remains retryable.

---

## 15. Batch sizing

The durable worker batch and the transport batch are different concepts.

For example:

```text
trend_jobs request size: 200
worker execution slices: 10
Python transport batch: benchmark-selected, e.g. 10–25
```

The initial Python transport batch should be established through measurement rather than becoming a permanent architectural constant.

The objective is to reduce network overhead without turning a single Python request into an unnecessarily large failure domain.

---

## 16. Cron non-disruption policy

The introduction of Python must not alter the scheduler topology.

Existing routes remain the scheduler's entrypoints, including the internal ingestion, trend-processing, partition-maintenance, stale-requeue, and geomagnetic jobs.

### Hard rules

- Do not rename cron endpoints.
- Do not change cron cadence as part of this migration.
- Do not move provider acquisition into Python.
- Do not move Redis locks into Python.
- Do not move PostgreSQL job claiming into Python.
- Do not make TLE ingestion synchronously dependent on Python.
- A Python outage must not invalidate the current TLE snapshot.
- A Python outage during trend processing must produce retryable work, not lost work.

### Ingestion remains independent

`/api/internal/ingest-tle` continues to own its existing ingestion lifecycle. Python is not inserted into the ingestion critical path during the first extraction unless a separate architectural review proves that a model is genuinely required there.

---

## 17. Re-entry migration sequence

### Phase 1 — preserve current model

Before moving code, freeze the behavior of the existing TypeScript implementation as the reference implementation.

Capture representative golden inputs covering:

- normal decaying debris
- stable debris
- low-altitude objects
- HEO objects
- raising-orbit / negative-BSTAR cases
- maneuver-like behavior
- contradictory trend cases
- strong solar-flux conditions
- geomagnetic correction cases
- insufficient data

### Phase 2 — port numerical primitives

Extract pure mathematical functions first.

Do not simultaneously redesign the equations.

### Phase 3 — port signal/model functions

Move the model-level pieces from the re-entry signal and trend explanation modules.

### Phase 4 — port `resolveReentryRisk()` as the resolution model

Represent it explicitly in Python as the composition layer that consumes:

```text
orbital state
trend evidence
environmental state
model parameters
```

and produces the final model decision plus diagnostics.

### Phase 5 — parity testing

Run the TypeScript and Python implementations against the same fixtures.

### Phase 6 — integrate through `BACKEND_URL`

Introduce a TypeScript `PythonComputeClient` responsible for:

- request construction
- timeout/deadline calculation
- service invocation
- response validation
- typed error handling

It must not contain duplicated scientific formulas.

### Phase 7 — shadow mode

Initially:

```text
TypeScript = authoritative
Python     = shadow
```

Compare numerical outputs, gate outcomes, tiers, confidence, and timing.

### Phase 8 — canary

Allow Python to become authoritative for a controlled subset while preserving a legacy fallback.

### Phase 9 — full authority

Switch to Python after correctness, reliability, latency, and operational behavior are acceptable.

Remove the legacy TypeScript implementation only after the Python model is established as the production source of truth.

---

## 18. Model versioning

Model versioning is separate from service versioning and API versioning.

### 18.1 Required identity

Each scientific model has:

```text
model_id
model_version
parameter_set_id
calibration_version
```

Example:

```text
model_id            = reentry_resolution
model_version       = 0.2.0
parameter_set_id    = reentry-2026-09-baseline
calibration_version = cal-2026-09-01
```

### 18.2 Existing trend version

The existing trend code uses `CURRENT_TREND_VERSION = 4`. Preserve that as the initial model version rather than discarding it during migration.

### 18.3 Versioning rules

- Patch version: implementation correction without intended model-behavior change.
- Minor version: meaningful model component/parameterization change within the same conceptual model.
- Major version: materially incompatible methodology or interpretation change.

Any change expected to alter scientific outputs requires a model-version decision, even when the HTTP schema remains unchanged.

### 18.4 Model result provenance

A production result should eventually be traceable to:

```text
input observation/window
model version
parameter set
environment state
calibration version
compute-engine version
```

---

## 19. Model registry

The initial registry can remain lightweight:

```python
MODEL_REGISTRY = {
    "reentry_resolution": {
        "version": "0.1.0",
        "parameter_set": "reentry-2026-09-baseline",
        "status": "production",
    },
}
```

Possible model states are:

```text
experimental
shadow
canary
production
deprecated
```

A registry is useful for model selection and provenance, but should not become an elaborate MLOps platform prematurely.

---

## 20. Internal analysis and calibration

The Python layer is also the home for analysis that should not be exposed as application API functionality.

Suggested structure:

```text
backend/
├── analysis/
│   ├── replay/
│   ├── calibration/
│   ├── sensitivity/
│   └── benchmarks/
```

### Production

```text
FastAPI
   ↓
production model function
```

### Internal analysis

```text
analysis script/notebook
   ↓
same production model function
```

### Calibration

```text
historical data
      ↓
replay
      ↓
parameter sweep / sensitivity analysis
      ↓
candidate parameter set
      ↓
validation
      ↓
approved calibration version
```

Every calibration run should record:

```text
model_id
model_version
parameter_set_id
calibration_version
dataset identifier
engine version
run timestamp
random seed, when applicable
```

---

## 21. Analysis data and reproducibility

Small deterministic fixtures belong in Git.

Large historical datasets should not be bundled into the FastAPI deployment artifact. When they become too large for the repository, store them in versioned external/object storage.

A replay should be reproducible from:

```text
dataset version
model version
parameter set
calibration version
environment inputs
engine/code version
```

This is particularly important for validating changes to the re-entry model against historical behavior.

---

## 22. Testing strategy

Scientific models require more than ordinary endpoint tests.

### Unit tests

Test individual numerical/model functions.

### Numerical invariant tests

Examples:

```text
perigee <= apogee
R² in [0, 1]
confidence in [0, 1]
invalid numeric inputs fail explicitly
```

### Golden tests

Use fixed representative DRAKON inputs and expected outputs.

### TypeScript/Python parity tests

Run the old and new implementations against the same inputs during migration.

### Contract tests

Validate:

- request schema
- response schema
- units
- enum semantics
- model metadata
- per-item batch status

### Integration tests

```text
Next.js route
   ↓
service binding
   ↓
FastAPI
   ↓
model
   ↓
response
   ↓
Next.js persistence
```

### Performance tests

Measure:

```text
cold-start latency
warm latency
batch latency
objects/second
memory usage
serialization overhead
end-to-end worker duration
```

Do not assume Python is faster without measuring the actual workload.

---

## 23. Failure isolation and rollback

Every migration stage must preserve rollback.

### Model rollback

A problematic model version can be disabled and a previous version can be restored through the model registry/configuration.

### Service rollback

If the Compute Engine is unavailable and a safe legacy implementation exists:

```text
Python unavailable
      ↓
TypeScript fallback
```

For background jobs:

```text
Python unavailable
      ↓
requeue unresolved job(s)
```

### Ingestion rollback

TLE ingestion remains independent of Python.

A Compute Engine outage must not cause catalog corruption, failed pruning decisions, or invalid serving state.

---

## 24. Security

The Compute Engine is an internal service.

- Do not expose a public rewrite to `compute`.
- Do not expose `BACKEND_URL` to browser/client code.
- Keep provider credentials in the service that owns the provider integration.
- Use application-level authentication/authorization on compute requests in addition to Vercel's Service Binding reachability.
- Keep analysis/calibration functionality internal.
- Validate all incoming model inputs.
- Validate model/version metadata before persisting results.

---

## 25. Observability

Every production compute call should expose structured metadata such as:

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

Useful metrics include:

```text
compute_requests_total
compute_failures_total
compute_timeouts_total
compute_duration_ms
compute_items_processed
compute_items_failed
model_disagreements_total
```

For scheduled workloads, the existing `trend_jobs` state remains the source of truth for work completion.

---

## 26. Deployment evolution

### Current target

```text
One repository
     │
     ▼
One Vercel project
     │
     ├── Next.js Service
     │     root: .
     │
     └── FastAPI Compute Service
           root: backend/
```

This is sufficient for the first generation of the Compute Engine and avoids introducing another hosting system prematurely.

### Why the Python code remains hosting-agnostic

The scientific model must not depend on Vercel-specific APIs.

Use:

```text
FastAPI
Pydantic
standard Python modules
NumPy/SciPy/domain libraries
```

for the model layer.

Vercel-specific behavior should be limited to deployment configuration and environment injection.

### Future hosting migration

If the workload eventually becomes unsuitable for request/Function execution—for example:

- very large simulations
- persistent worker processes
- long-running batch jobs
- workloads exceeding practical request deadlines

then the Compute Engine can move to another runtime/container architecture without rewriting the scientific model API.

The intended evolution is:

```text
FastAPI model layer
       │
       ├── Vercel Services today
       │
       └── dedicated container/worker later, if justified
```

The service contract remains the stable boundary.

---

## 27. Vercel Services risk and fallback

Vercel Services is currently in **Beta on all plans**. This is an explicit platform risk because the current architecture relies on multi-service routing and Service Bindings.

This risk should be contained rather than ignored.

### Current assumption

The project uses the current `services` configuration model and Service Bindings.

### Legacy configuration

The older `experimentalServices` configuration model is not the target architecture. It remains available as migration documentation for older projects/configurations.

### Fallback if Services becomes a blocker

The Python implementation can fall back to the conventional single-service Python Function model using a standard `api/` entrypoint and `pyproject.toml`, or the FastAPI service can be deployed independently.

The fallback loses the clean private binding topology, but it does not require rewriting:

```text
Python model code
Pydantic contracts
FastAPI route layer
model versioning
analysis tooling
```

This is why Vercel-specific configuration must remain outside the scientific model implementation.

---

## 28. CI/CD

The repository should test the two runtimes independently, then validate their boundary.

```text
TypeScript lint/tests
        │
        ├─────────────┐
        │             │
Python tests         │
        │             │
        └──────┬──────┘
               ▼
       contract/parity tests
               │
               ▼
       Services deployment build
```

The Python dependency lock/configuration should be committed.

Research notebooks and calibration experiments may be run through their own commands without becoming mandatory production deployment steps.

---

## 29. Definition of done — first extraction

### Architecture

- [ ] `app/api/*` remains 100% TypeScript.
- [ ] `backend/` is an independent FastAPI service root.
- [ ] Next.js and FastAPI are defined as Vercel Services.
- [ ] Top-level `/(.*) → web` rewrite is present.
- [ ] `compute` has no public rewrite.
- [ ] `BACKEND_URL` is supplied by a Service Binding.
- [ ] Python service has its own `maxDuration` configuration.
- [ ] Browser worker architecture remains untouched.

### Re-entry model

- [ ] `resolveReentryRisk()` is explicitly represented as the Re-entry Resolution Model.
- [ ] Solar-flux input is explicit.
- [ ] Geomagnetic correction/state is explicit.
- [ ] HEO gates are covered.
- [ ] Maneuver/raising-orbit gates are covered.
- [ ] Pessimistic-of-two resolution is covered.
- [ ] Tier boundaries are covered.
- [ ] TIP remains external/reference composition in TypeScript.

### Trend processing

- [ ] Durable `trend_jobs` ownership remains in TypeScript.
- [ ] Existing job claiming/retry/persistence semantics remain intact.
- [ ] Partial batch response semantics are implemented.
- [ ] Per-object errors identify retryability.
- [ ] Python/service timeouts are included in the outer deadline budget.
- [ ] Unresolved work is requeueable.

### Scientific governance

- [ ] Model ID/version exists.
- [ ] Parameter-set ID exists.
- [ ] Calibration version exists when applicable.
- [ ] Golden fixtures exist.
- [ ] TypeScript/Python parity tests exist.
- [ ] Analysis uses the production model implementation.

### Operations

- [ ] Existing cron cadence is unchanged.
- [ ] TLE ingestion remains independent of Python.
- [ ] Python outage cannot corrupt ingestion state.
- [ ] Rollback to TypeScript is available during migration.

---

## 30. Long-term architecture

```text
                                DRAKON
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   Browser Compute          Application Plane          Compute Plane
   TypeScript Workers       Next.js / TypeScript       Python / FastAPI
          │                        │                        │
          │                        ├── /api/*               ├── Re-entry
          ├── SGP4                 ├── Providers            ├── Orbital models
          ├── tracks               ├── Redis                ├── Collision analysis
          ├── globe state          ├── PostgreSQL            ├── Uncertainty
          └── interactive density  └── Cron/jobs             ├── Simulation
                                                               └── Calibration
```

The success criterion is not "DRAKON uses Python everywhere."

The success criterion is:

> **DRAKON has a stable application plane and a scientifically disciplined compute plane, with explicit workload placement, reproducible model behavior, versioned scientific outputs, durable job orchestration, and a deployment boundary that can evolve independently of the model implementation.**

---

## 31. Final architectural rules

1. **`app/api/*` remains TypeScript.**
2. **Browser real-time computation remains in Web Workers.**
3. **Python is for server-side scientific computation whose complexity or lifecycle justifies the boundary.**
4. **`resolveReentryRisk()` is a first-class model boundary.**
5. **Solar-flux and geomagnetic state enter the model explicitly; acquisition remains outside it.**
6. **Cron remains the operational control plane.**
7. **PostgreSQL/Redis remain application-owned initially.**
8. **Durable job state remains outside FastAPI.**
9. **Batch APIs must support partial success with per-object status/error.**
10. **The Python hop is part of the existing 60-second DRAKON execution budget.**
11. **The current 60-second cap is an intentional DRAKON setting, not the current Hobby platform maximum.**
12. **Each service receives its own runtime configuration; compute must explicitly define its own duration.**
13. **Vercel Services is the initial deployment model and is currently Beta on all plans.**
14. **The `experimentalServices` model is legacy and is not the target architecture.**
15. **A future hosting migration must not require rewriting scientific model code.**
16. **Model version is distinct from API/service version.**
17. **Production and calibration use the same Python model implementation.**
18. **Scientific behavior changes require explicit version/calibration decisions.**

---

## 32. References

### DRAKON repository

The architecture was derived from the current repository structure and implementation boundaries, including:

- `lib/objectTrendRisk.ts`
- `lib/satelliteHelpers.ts`
- `lib/explainReentryTrend.ts`
- `lib/jobs/computeObjectTrends.ts`
- `lib/workers/satellite.worker.ts`
- `lib/satelliteWorker.ts`
- `app/api/internal/process-trends/route.ts`
- `app/api/internal/ingest-tle/route.ts`
- `app/api/internal/manage-tle-partitions/route.ts`
- `docs/TLE_PIPELINE_ARCHITECTURE.md`
- `docs/REENTRY_RISK.md`
- `docs/GEOMAGNETIC_CALIBRATION_LOG.md`

### Vercel

- Vercel Services: https://vercel.com/docs/services
- Complete Guide to Vercel Services: https://vercel.com/kb/guide/vercel-services
- Service Bindings: https://vercel.com/changelog/secure-internal-communication-between-services
- Run multiple frameworks in one project: https://vercel.com/changelog/run-multiple-frameworks-in-one-project-with-vercel-services
- Services + Fluid Compute: https://vercel.com/kb/guide/vercel-services-fluid-compute
- Fluid Compute: https://vercel.com/docs/fluid-compute
- Vercel project configuration: https://vercel.com/docs/project-configuration/vercel-json
- Legacy `experimentalServices`: https://vercel.com/docs/services/experimental

The deployment portions of this plan are based on the current `services` model and intentionally do not use the legacy `experimentalServices` configuration.
