# TLE History and Trend Pipeline

## 1. Purpose and scope

The TLE history pipeline converts repeated orbital element observations into a durable time series and a derived per-object trend model. It is the analytical layer between the current TLE catalog and DRAKON's re-entry screening and analysis interfaces.

The pipeline has four responsibilities:

1. Persist normalized orbital observations in PostgreSQL.
2. Preserve raw TLE material needed for object-name recovery and provenance.
3. Convert newly observed epochs into asynchronous trend-computation jobs.
4. Recompute and publish per-object decay, maneuver, confidence, and re-entry estimates without blocking TLE ingestion or client requests.

Provider acquisition, provider fallback, snapshot merging, authoritative pruning, Redis serving, and partition maintenance are documented in [TLE_PIPELINE_ARCHITECTURE.md](./TLE_PIPELINE_ARCHITECTURE.md). This document starts at the point where an accepted `TleEntry` is passed to `ingestTleHistory()` and follows the data through historical storage, trend computation, APIs, and the client.

The key architectural decision is that **history ingestion and trend computation are asynchronous stages**. Ingestion records evidence quickly and enqueues work; a separate worker computes the more expensive historical model later.

## 2. Architectural principles

The implementation is built around several invariants:

- Historical observations are immutable at the `(norad_id, epoch)` level.
- Provider provenance is retained in `source_group`.
- Raw TLE storage and normalized analytical storage have different responsibilities.
- A new historical epoch immediately creates a trend job, but trend computation never runs inline with the ingestion request.
- At most one pending trend job exists for an object.
- Trend workers use `FOR UPDATE SKIP LOCKED` so multiple executions can safely claim work without blocking one another.
- A failed object computation must not abort the rest of the batch.
- Successful jobs are removed from the queue; exhausted failures are removed after three attempts.
- Trend algorithm changes are versioned rather than requiring a database migration.
- Public trend reads never perform background work.
- `trend_snapshots` records meaningful classification changes rather than every recomputation.
- Current catalog freshness, historical-data freshness, and derived-trend freshness are separate operational states.

## 3. End-to-end architecture

```mermaid
flowchart TB
    subgraph acquisition [TLE Acquisition]
        FETCH[Space-Track / CelesTrak]
        INGEST[POST /api/internal/ingest-tle]
    end

    subgraph history [Historical Ingestion]
        SERVICE[runIngestionCycle]
        NORMALIZE[parse + validate TleEntry]
        HIST[ingestTleHistory]
        FETCH --> INGEST --> SERVICE --> NORMALIZE --> HIST
    end

    subgraph db [PostgreSQL]
        TH[(tle_history)]
        TA[(tle_archive)]
        TJ[(trend_jobs)]
        OT[(object_trends)]
        TS[(trend_snapshots)]
    end

    HIST --> TH
    HIST --> TA
    HIST --> TJ

    subgraph worker [Asynchronous Trend Worker]
        CRON[cron-job.org · every 15 min]
        ROUTE[POST /api/internal/process-trends]
        CLAIM[Claim with SKIP LOCKED]
        COMPUTE[recomputeTrends]
        UPSERT[upsertTrend]
        CRON --> ROUTE --> CLAIM --> COMPUTE --> UPSERT
    end

    TJ --> CLAIM
    TH --> COMPUTE
    TA --> COMPUTE
    UPSERT --> OT
    UPSERT --> TS
    TJ -->|success: delete| WORKDONE[Queue remains small]

    subgraph api [Read APIs]
        TRENDAPI[GET /api/object-trends]
        CHANGEAPI[GET /api/object-trends/recent-changes]
        SNAPAPI[GET /api/object-trends/[noradId]/snapshots]
    end

    OT --> TRENDAPI
    OT --> CHANGEAPI
    TS --> CHANGEAPI
    TS --> SNAPAPI

    subgraph client [Client]
        HOOK[useObjectTrendsQuery]
        RESOLVE[resolveReentryRisk]
        UI[Globe / Panels / Analysis]
        TRENDAPI --> HOOK --> RESOLVE --> UI
        CHANGEAPI --> UI
        SNAPAPI --> UI
    end
```

The pipeline is deliberately not a request-time analytics system. The globe and analysis pages consume already-computed database state.

## 4. Data model

The schema is defined in `lib/db/schema.ts`.

### 4.1 `tle_history`

`tle_history` is the normalized orbital time series. It is range-partitioned by `epoch`.

Each observation contains the TLE-derived state needed by downstream analysis:

| Field group | Data |
| --- | --- |
| Identity | `norad_id`, `epoch` |
| Drag / propagation | `bstar`, `mean_motion`, `mean_motion_dot`, `eccentricity` |
| Orbital geometry | `inclination`, `raan`, `arg_perigee`, `mean_anomaly`, `perigee_km`, `apogee_km`, `semi_major_axis_km` |
| Provenance | `ingested_at`, `source_group` |

The `(norad_id, epoch)` uniqueness rule prevents repeated publication of the same element set from creating duplicate observations.

The `(norad_id, epoch)` index supports object/time-series access. The `ingested_at` index supports recent-ingestion sweeps.

Orbital geometry is calculated during ingestion and stored. The trend worker therefore consumes normalized numerical fields instead of repeatedly parsing TLE text or recomputing geometry.

Partition granularity and retention are owned by `lib/db/tlePartitions.ts`. The current migration changes new ranges from monthly to daily partitions; the details and legacy-partition handling are documented in `TLE_PIPELINE_ARCHITECTURE.md`.

### 4.2 `tle_archive`

`tle_archive` preserves the raw representation needed for point lookup:

- `norad_id`
- `epoch`
- object `name`
- `tle_line1`
- `tle_line2`
- `stored_at`

It is unique on `(norad_id, epoch)`.

The archive is intentionally separate from `tle_history`: normalized history is optimized for numerical analysis, while the archive preserves the original TLE representation and object name. Ingestion prunes the archive to the three most recent rows per touched NORAD ID, so it is not intended to become an unlimited raw-data warehouse.

The trend worker batch-fetches archive names for claimed jobs in one query, ordered by NORAD ID and descending epoch, and uses the newest name available for object classification.

### 4.3 `trend_jobs`

`trend_jobs` is an ephemeral work queue.

| Field | Purpose |
| --- | --- |
| `id` | Queue identity |
| `norad_id` | Object requiring recomputation |
| `created_at` | Queue ordering and operational diagnostics |
| `status` | `pending`, `processing`, or `failed` |
| `error_message` | Last computation failure |
| `retry_count` | Number of failed attempts |

There is a partial unique constraint on pending jobs by NORAD ID. This means repeated TLE observations can request recomputation without creating an unbounded number of duplicate pending jobs for the same object.

Completed jobs are deleted rather than retained as `done` rows. The queue therefore represents current work and backlog rather than historical job execution records.

### 4.4 `object_trends`

`object_trends` is the derived cache and contains one current row per NORAD ID.

It stores four classes of information:

**Coverage:** `epochs_available`, `history_days_available`, `trend_version`.

**Regression features:** latest values and slopes for BSTAR, perigee, apogee, semi-major axis, and mean-motion derivative.

**Classification:** `decay_signal`, `maneuver_likelihood`, `decay_confidence`, and per-signal strengths.

**Re-entry result:** `estimated_days_remaining`, `estimated_reentry_at`, and `reentry_tier`.

Object metadata includes `object_type`, `is_debris`, and `updated_at`.

`trend_version` is part of the cache-validity contract. The current implementation uses `CURRENT_TREND_VERSION = 4`. A regression or classification change should increment this version so old derived rows can be identified and recomputed.

### 4.5 `trend_snapshots`

`trend_snapshots` is an append-only outcome-change log, not a periodic raw trend dump.

A snapshot is written by `upsertTrend()` only when the object's `reentry_tier` or `decay_signal` differs from its previous stored value. A recomputation that produces the same classification does not create another snapshot.

This makes the table useful for operational questions such as:

- when did an object become actionable?
- when did its classification change?
- what estimate accompanied that transition?

The `(norad_id, captured_at)` index supports latest-first per-object history queries.

## 5. Historical ingestion

The sole production path into historical storage is:

```text
POST /api/internal/ingest-tle
        |
        v
runIngestionCycle()
        |
        +--> ingestTleHistory(primary entries, provider label)
        |
        +--> ingestTleHistory(debris entries, celestrak:debris label)
```

The provider and snapshot mechanics before these calls are documented separately in `TLE_PIPELINE_ARCHITECTURE.md`.

`GET /api/tle` does not write history. This is an important architectural boundary: client requests cannot accidentally become ingestion triggers.

### 5.1 Validation

`ingestTleHistory()` validates each parsed entry before persistence. The important basic validity conditions include a finite epoch and positive mean motion.

Invalid entries are counted and skipped rather than being inserted as malformed historical evidence.

The function returns:

```typescript
{
  inserted: number;
  skipped: number;
  invalid: number;
}
```

`inserted` counts newly accepted epochs, `skipped` represents epochs already present, and `invalid` represents entries rejected before persistence.

### 5.2 Chunking and concurrency

Large provider responses are divided into fixed-size chunks. Chunks are processed concurrently in groups of four using `Promise.allSettled`.

Each chunk owns a disjoint portion of the input, so concurrent execution does not share mutable ingestion state.

`Promise.allSettled` is intentional: one failed chunk is logged and skipped without preventing other chunks from completing. This isolates a database or transport problem affecting one chunk from the remainder of the catalog.

The design replaced the earlier sequential failure mode in which an exception during archive maintenance could abort the loop and prevent later objects from being persisted or queued for trend computation.

### 5.3 History write and job creation

For each chunk:

1. Insert normalized observations into `tle_history` using conflict-safe insertion on `(norad_id, epoch)`.
2. Determine which rows were actually new.
3. Archive raw TLE material only for newly inserted epochs.
4. Enqueue one pending trend job per affected NORAD ID.
5. Prune the raw archive for the touched objects.

Trend jobs are created immediately after new historical evidence is accepted. Trend computation itself does not run in this request.

### 5.4 Archive pruning

The archive is kept intentionally small: only the three most recent raw TLE rows per touched object are retained.

Pruning is wrapped in its own failure boundary. If archive cleanup fails, the error is logged but the failure does not roll back or prevent history insertion and trend-job enqueueing.

This is an operationally important distinction: archive retention is maintenance work; historical observation persistence is the primary data path.

## 6. Trend-job queue semantics

A newly inserted historical epoch makes its object eligible for recomputation. The pending partial unique index collapses multiple observations for the same object into one pending job.

For example:

```text
Object 12345 receives epochs A, B, C during ingestion
             |
             +--> enqueue(12345)
             +--> enqueue(12345) -> conflict / ignored
             +--> enqueue(12345) -> conflict / ignored
             |
             v
        one pending job
```

This is sufficient because the worker recomputes the object from the current historical window rather than processing one job per epoch.

## 7. Trend worker

The primary worker entry point is:

`POST /api/internal/process-trends`

It is authenticated with `x-internal-secret` and invoked externally every 15 minutes. The route uses a serverless execution ceiling of 60 seconds. The externally configured cron timeout must also accommodate the actual execution time.

The worker is deliberately separate from the ingestion route. Trend computation performs multiple historical queries and per-object writes; coupling it to ingestion would increase ingestion latency and create a larger timeout/failure domain.

### 7.1 Claiming jobs

Jobs are claimed with PostgreSQL `FOR UPDATE SKIP LOCKED`.

Conceptually:

```text
pending jobs
     |
     +--> transactionally claim oldest rows
             |
             +--> status = processing
             |
             v
        worker execution
```

`SKIP LOCKED` allows another worker invocation to skip rows already being claimed instead of waiting on their locks.

At the beginning of each worker invocation, lingering `processing` rows from a previous failed invocation are removed. These rows represent abandoned execution state; legitimately in-flight rows are protected by the database transaction and do not appear as abandoned to a concurrent claim.

### 7.2 Batch and object concurrency

The worker claims a bounded batch and processes objects in slices of ten with `Promise.allSettled`.

Progress is persisted after each slice:

- successful job IDs are deleted immediately;
- failed jobs are returned to `pending` and have their retry count incremented;
- jobs reaching three failed attempts are deleted after being logged as exhausted.

Persisting progress slice-by-slice means a serverless timeout does not erase all successful work completed earlier in the same invocation.

The queue is therefore designed for at-least-once recomputation semantics rather than exactly-once execution. Database uniqueness and idempotent upserts make repeated computation safe.

## 8. Trend recomputation algorithm

`recomputeTrends()` loads up to 30 days of historical observations for the object, ordered by epoch.

The model intentionally uses the same historical window for all objects, while applying different minimum-data requirements depending on object class.

### 8.1 Data sufficiency

The absolute minimum is three epochs.

The current minimum history span is:

- payload / non-debris objects: 7 days;
- debris / rocket-body objects: 1 day.

Objects that do not meet both the epoch-count and object-specific history requirements receive:

```text
decay_signal = insufficient_data
reentry_tier = stable
```

The row still records available coverage and latest values so the API can distinguish an object with no history from one that is actively being accumulated.

### 8.2 Object classification

The worker obtains the latest object name from `tle_archive` and passes it through `classifyObjectType()`.

The resulting object type is used to determine whether the object is treated as debris/rocket body for the minimum-history policy and downstream screening behavior.

This classification is separate from the provider-source label. An object being ingested from CelesTrak does not by itself mean that it is classified as debris.

### 8.3 Regression model

The worker computes weighted linear regressions over 7-day, 14-day, and 30-day windows for the primary orbital indicators.

The weighted regression uses exponential recency weighting rather than treating every historical epoch equally. The weighting half-life is:

- 3 days normally;
- 1 day when the latest perigee is below 250 km, making the model more responsive to terminal decay.

The principal computed features are:

| Signal | Windows / features |
| --- | --- |
| BSTAR | latest, slope 7d/14d/30d, mean, standard deviation, R² over 14d |
| Perigee | latest, slope 7d/14d/30d |
| Apogee | latest, slope 14d |
| Semi-major axis | latest, slope 7d/14d |
| N-dot | latest, mean over 14d, weighted 14d regression |

The regression implementation records R² and dispersion where relevant so a strong-looking slope can be evaluated together with the quality of the underlying fit.

### 8.4 Signal interpretation

The final classification is delegated to `explainReentryTrend()` rather than being duplicated inside the worker. That function produces:

- overall decay signal;
- decay confidence;
- maneuver likelihood;
- BSTAR signal strength;
- N-dot signal strength;
- altitude signal strength;
- consensus requirement and whether it was met;
- re-entry tier;
- estimated days remaining and estimated re-entry time.

This separation keeps numerical feature generation in `computeObjectTrends.ts` and decision/explanation logic in `explainReentryTrend.ts`.

The current implementation does not simply treat one positive slope as proof of decay. The final result depends on the combined signal interpretation and object-specific consensus rules.

### 8.5 Terminal-decay behavior

When the latest perigee falls below 250 km, the regression weighting becomes more recent-sensitive. This is designed to prevent long historical behavior from dominating the estimate when the object has entered a rapidly changing terminal phase.

This threshold affects model responsiveness; it is not itself a declaration that re-entry has occurred.

## 9. Trend persistence

`upsertTrend()` is the single persistence boundary for the derived object state.

It first reads the existing `reentry_tier` and `decay_signal`, then upserts the new `object_trends` row, then compares old and new outcomes.

If either outcome changed, a `trend_snapshots` row is appended.

This produces two distinct data products:

```text
object_trends
    = current state

trend_snapshots
    = meaningful state transitions
```

A repeated recomputation with identical classification therefore updates `object_trends.updated_at` but does not grow `trend_snapshots`.

## 10. Trend versioning and invalidation

`CURRENT_TREND_VERSION` is currently `4`.

It represents the version of the derived trend algorithm, not the schema version.

When the regression, confidence, or classification logic changes:

1. increment `CURRENT_TREND_VERSION`;
2. existing rows become stale because their stored version is lower;
3. stale rows are requeued by the requeue mechanism;
4. workers recompute them using the new algorithm;
5. the public trend API exposes only rows matching the current version.

This allows algorithm changes to be rolled out without rewriting the table schema.

## 11. Requeue and recovery behavior

`POST /api/internal/requeue-stale` is an operational maintenance endpoint. It identifies `object_trends` rows whose `trend_version` is below `CURRENT_TREND_VERSION` and re-enqueues those objects for recomputation.

This mechanism is intentionally version-based. A trend row does not need to wait for another TLE epoch to become eligible for recomputation after an algorithm upgrade.

The trend queue also provides retry-based recovery for individual computation failures. A failed job is retried up to three times before being removed as exhausted.

## 12. Public APIs

### `GET /api/object-trends`

Read-only endpoint for current derived trends.

The public result is filtered to the current `CURRENT_TREND_VERSION` and excludes `insufficient_data` rows from the actionable trend set.

The endpoint does not enqueue jobs, recompute trends, or execute background callbacks. It is a database read path.

### `GET /api/object-trends/recent-changes`

Reads recent classification changes from `trend_snapshots` for dashboard triage. It is intended to answer which objects have recently changed operational state rather than returning every recomputation.

### `GET /api/object-trends/[noradId]/snapshots`

Returns the transition history for a single object. The `(norad_id, captured_at)` index supports latest-first access.

### `GET /api/tle`

The client TLE endpoint is documented here only as a boundary. It is now a pure Redis read and does not perform historical ingestion. The complete current-catalog read behavior is documented in `TLE_PIPELINE_ARCHITECTURE.md`.

## 13. Client consumption

The client uses two independent query paths:

| Hook | Endpoint | Role |
| --- | --- | --- |
| `useTleEntriesQuery` | `/api/tle` | Current orbital catalog for globe rendering |
| `useObjectTrendsQuery` | `/api/object-trends` | Derived trend data when re-entry analysis is enabled |

The globe combines these datasets and passes the relevant object/trend information through `resolveReentryRisk()`.

The important separation is:

```text
TLE snapshot = what the latest catalog says
Trend model  = what historical evidence says
Risk resolver = how those signals are presented as an operational state
```

The UI does not perform regression itself.

The Analysis page consumes current trend state and historical `trend_snapshots` to provide a deeper object-level explanation and change history.

## 14. Explainability architecture

Trend computation persists the numerical signal contributions needed for the current result:

- `bstar_signal_strength`
- `ndot_signal_strength`
- `altitude_signal_strength`
- `consensus_required`
- `consensus_met`

`lib/explainReentryTrend.ts` owns the signal interpretation and explanation model. The persisted breakdown means the Analysis layer does not need to reverse-engineer the current classification from raw historical data merely to explain what the worker already decided.

For older rows that predate the persisted fields, the Analysis layer can reconstruct the contribution representation through `reconstructSignalContributions` rather than silently assuming those columns are populated.

This is intentionally different from re-running the complete trend algorithm on every page view.

## 15. Freshness model

The history system has multiple asynchronous clocks:

**TLE acquisition freshness** is controlled by the upstream ingestion schedule and provider behavior.

**History freshness** is the age of the latest accepted epoch in `tle_history`.

**Queue freshness** is the age of pending work in `trend_jobs`.

**Trend freshness** is `object_trends.updated_at` relative to the latest historical evidence and current algorithm version.

**Snapshot freshness** describes the most recent meaningful classification transition, not the most recent recomputation.

These values can legitimately diverge. For example, a new TLE can be present in `tle_history` while its trend job is still pending; the current trend row may therefore temporarily represent the previous history window.

This is why the architecture does not attempt to synchronously recompute trends during TLE ingestion or API reads.

## 16. Failure isolation and operational behavior

### History-ingestion failure

A failed ingestion chunk does not prevent other chunks from completing. The ingestion summary reports aggregate inserted/skipped/invalid counts, while individual chunk errors are logged.

### Archive-pruning failure

Archive cleanup failure is non-fatal. Historical evidence and trend-job enqueueing remain higher priority.

### Trend-computation failure

A single failed object computation is isolated through `Promise.allSettled`. Its job is returned to `pending`, its error is recorded, and it can be retried independently of successful objects in the same worker batch.

### Exhausted trend failure

After three failed attempts, the job is removed and logged as exhausted. This prevents a permanently broken object from blocking or repeatedly consuming the queue.

### Worker interruption

Successful slices are deleted from the queue as soon as they complete. Work completed before a timeout therefore survives the interrupted invocation.

### Public-read failure

Public trend endpoints do not attempt to repair missing or stale derived state. Recovery belongs to the ingestion, worker, and requeue mechanisms. This keeps API latency deterministic and prevents user traffic from becoming an accidental background scheduler.

## 17. Performance model

The pipeline separates work by cost:

```text
Hourly ingestion
  -> relatively cheap parsing + batch writes + enqueue

Every 15 minutes
  -> bounded historical reads + regression + derived writes

Client request
  -> indexed database reads only
```

The main performance controls are:

- chunked history insertion;
- four-way ingestion chunk concurrency;
- one pending job per NORAD ID;
- bounded worker batches;
- ten-way object computation concurrency;
- batched archive-name lookup;
- `FOR UPDATE SKIP LOCKED` job claiming;
- per-slice progress persistence;
- partition-level historical retention;
- derived-state reads from `object_trends` instead of recalculating from raw history.

The trend worker deliberately does not load all historical data for the entire catalog into memory. Each object is evaluated against its own 30-day history window.

## 18. Consistency model

The system provides eventual consistency between historical evidence and derived trend state.

A normal sequence is:

```text
new TLE epoch
    |
    v
insert tle_history
    |
    v
enqueue trend job
    |
    v
worker claims job
    |
    v
read latest 30-day history
    |
    v
recompute + upsert object_trends
    |
    v
optionally append trend_snapshot
```

There is intentionally no requirement that every stage complete inside the original ingestion request.

The database is authoritative for historical observations and current derived trends; the queue is the bridge between them.

## 19. Known limitations

The current design has several deliberate limitations:

- `tle_history` represents observations available from repeated provider publications; it is not an independently reconstructed orbital ephemeris history.
- Trend estimates depend on the quality, cadence, and continuity of incoming TLEs.
- Payloads require a longer history span than debris/rocket bodies before trend computation becomes actionable.
- A stale trend row can temporarily coexist with newer history while its queue job is pending.
- Exhausted jobs are logged but are not retained as a durable job-history table.
- `tle_archive` is intentionally limited to the three most recent raw TLEs per object.
- Algorithm versioning invalidates derived rows, but recomputation still depends on the worker queue being healthy.
- Public APIs intentionally do not repair stale data themselves.
- Trend classification is a screening model and should not be interpreted as an authoritative external re-entry prediction service.

## 20. Engineering invariants

Future changes should preserve these properties:

1. `(norad_id, epoch)` remains unique in `tle_history`.
2. New historical epochs enqueue trend work without running the trend model inline.
3. There is at most one pending trend job per NORAD ID.
4. Trend workers remain safe under concurrent execution through `SKIP LOCKED`.
5. One failed object computation must not abort successful objects in the same batch.
6. Successful worker progress is persisted incrementally.
7. Retry count remains bounded at three attempts.
8. `object_trends` represents current state; `trend_snapshots` represents meaningful state transitions.
9. Snapshot rows are not written merely because a recomputation occurred.
10. `trend_version` must change when the analytical algorithm changes materially.
11. Public trend APIs remain read-only.
12. Object classification and provider provenance remain separate concepts.
13. Raw TLE archival must not become a prerequisite for successful historical ingestion.
14. Historical retention must remain compatible with the 30-day trend-analysis window.
15. Client traffic must not become an implicit trend scheduler.

## 21. Key implementation files

| Responsibility | Implementation |
| --- | --- |
| Historical schema | `lib/db/schema.ts` |
| TLE parsing / derived orbital geometry | `lib/tle.ts`, `lib/satelliteHelpers.ts` |
| History ingestion | `lib/jobs/ingestTleHistory.ts` |
| Trend computation | `lib/jobs/computeObjectTrends.ts` |
| Signal explanation / classification | `lib/explainReentryTrend.ts` |
| Trend API | `app/api/object-trends/route.ts` |
| Recent changes API | `app/api/object-trends/recent-changes/route.ts` |
| Object snapshot API | `app/api/object-trends/[noradId]/snapshots/route.ts` |
| Trend worker route | `app/api/internal/process-trends/route.ts` |
| Stale-version requeue | `app/api/internal/requeue-stale/route.ts` |
| Partition maintenance | `lib/db/tlePartitions.ts` |
| Current TLE acquisition architecture | `docs/TLE_PIPELINE_ARCHITECTURE.md` |
| Re-entry screening | `docs/REENTRY_RISK.md` |

## 22. Related documentation

- [TLE Pipeline Architecture](./TLE_PIPELINE_ARCHITECTURE.md) — provider acquisition, snapshot assembly, Redis serving, and partition maintenance.
- [Re-entry Risk](./REENTRY_RISK.md) — screening, risk resolution, operational tiers, and Decision Trace.
- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
