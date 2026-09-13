# Python Compute Shadow — Rollout Plan

Live-data validation of `resolve_reentry_risk()` (the ported Python
Re-entry Resolution Model, `docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md`
Phases 1-4) against `resolveReentryRisk()` (the TypeScript reference),
before any canary rollout of the Python result as authoritative.

## Why shadow now, not after golden fixtures + a local HTTP round-trip

Golden fixtures (`fixtures/reentry-model/golden_cases.json`) and the
end-to-end client tests (`lib/reentryComputeClient.e2e.test.ts`,
`lib/pythonComputeShadow.e2e.test.ts`) already prove: the Python port is
numerically correct against hand-picked reference cases, and the full
wire path (TS client -> HTTP -> Python -> HTTP -> TS) works. What they
can't prove is how the model behaves across the actual, messy
distribution of production catalog data: rare object classes, odd TLEs,
missing trend fields, boundary altitudes, real BSTAR distributions, real
HEO cases, real maneuvering candidates, actual environmental values. That
requires real production data, and there's no reason to wait for a canary
stage to start collecting it.

## Architecture

```
existing cron (cron-job.org, every 15-30 min)
      |
      v
POST /api/internal/python-compute-shadow
      |
      +-- load current catalog (lib/geomagneticShadowCatalog.ts's
      |   loadCurrentCatalogForShadow() -- same catalog source the
      |   geomagnetic shadow already uses)
      |
      +-- stratified sample (lib/pythonComputeShadowSampling.ts)
      |   10-20% rate, hard-capped at 20-25 objects/run,
      |   stratified by (reentryTier, decaySignal) so rare-but-important
      |   branches (critical tier, maneuvering candidates) aren't missed
      |   by chance the way a pure random sample could miss them
      |
      +-- authoritative TS result (resolveReentryRisk(), unaffected)
      |
      \-- sampled shadow comparison (shadowCompareReentryRisk() per
          sampled object, budget-aware per-call timeout)
              |
              +-- TS remains authoritative -- Python result never used
              |   for anything user-facing during shadow
              +-- Python failure = non-fatal, recorded as telemetry only
              +-- persisted: python_compute_shadow_runs (run-level
                  summary) + python_compute_shadow_object_deltas
                  (one row per object that did NOT cleanly match --
                  matched rows are not stored, same convention as
                  geomagnetic_shadow_object_deltas)
```

Never wired to synchronously evaluate 100% of the trend-computation
workload: every sampled object costs one HTTP call to the compute engine,
and putting that behind every trend job would turn ~200 jobs into ~200
additional HTTP requests per cron run, eroding the execution budget this
architecture was specifically built to protect (see
`backend/vercel.json`'s per-service `maxDuration` and this route's own
`PERSISTENCE_RESERVE_MS`-based budget calculation in
`app/api/internal/python-compute-shadow/route.ts`).

## Rollout steps

| Step | Duration | Sample rate | Cap | Goal |
|---|---|---|---|---|
| 1 | 1 day | 5-10% | ~20 objects/run | Validate telemetry, latency, and failure handling actually work against real data -- not a volume target |
| 2 | 7 days | 10-20% | 20-25 objects/run | Reach several thousand comparisons; inspect every unexplained difference by hand |
| 3 | up to 14 days | same or slightly larger | 20-25 objects/run | Reach the full exit-criteria evidence threshold (below); canary readiness review |

If the evidence threshold is met before day 14 and branch coverage looks
adequate, move to canary early — 14 days is a ceiling on how long shadow
needs to run, not a fixed requirement independent of what the data shows.

## Exit criteria (all must hold before canary)

**1. Volume.** ≥10,000 successful shadow comparisons
(`matchedCount + valueMismatchCount` summed across runs — see
`summarizePythonComputeShadowWindow()` in
`lib/pythonComputeShadowStore.ts`). Achievable within 14 days at a modest
sample rate given the sampling cap.

**2. Zero unexplained categorical/model disagreement.** For an exact
0.1.0 port, these should never differ given the same inputs:

| Field differs | Classification |
|---|---|
| `tier` | blocker |
| `confidence` | blocker |
| `source` | blocker |
| `estimatedDaysRemaining` | investigate |
| any other unexpected branch outcome | blocker |

Every `python_compute_shadow_object_deltas` row with
`pythonFailureType = 'MODEL_VALUE_MISMATCH'` needs to be reviewed against
this table before canary — a mathematically identical port should not
produce unexplained logical disagreement.

**3. Numerical differences stay inside the declared tolerance.** Only
`bstar`, `decayRateKmPerDay`, and `decayAltKm` may differ, and only within
the tolerance documented in `backend/tests/_golden_compare.py` and
`lib/shadowCompareReentryRisk.ts`'s `TOLERANCE_FIELDS` (both must stay in
sync — they're the same cross-runtime floating-point noise). Everything
else must match exactly.

**4. Python reliability.** ≥99.5% successful compute calls
(`successCount / sampledCount`, summed across the window). Investigate
every timeout/network failure individually. For a private internal
compute service, prefer ≥99.9% before treating it as authoritative.

**5. Latency.** Measure p50/p95/p99 (`durationMsP50/P95/P99` per run) and
compare against the existing cron's runtime. The criterion isn't an
absolute number — it's that shadowing must not materially erode the
existing cron's execution margin. The trend-computation cron has a
60-second cap with a 45-50s soft budget; the shadowed route should stay
comfortably below its own budget with no new timeout trend.

**6. No pipeline regression.** During the shadow window, trend jobs
completed/retried/dropped and cron invocation duration/timeout count
should look statistically normal compared to the pre-shadow baseline. The
Python service is a diagnostic dependency here, not a critical one — a
regression in these numbers means the shadow calls are interfering with
real work, which is itself a reason to slow down or stop.

## After shadow: canary, not a single flip

```
Shadow                              Canary                25%    50%    100%
TS authoritative / Python           1-5%
observational                       Python authoritative,
                                     TS fallback + still
                                     computed for comparison
```

Canary is qualitatively different from shadow: Python's result actually
becomes the selected result for a subset of traffic. Keep computing the
TS reference alongside it for a period even during canary — that's what
makes canary safe, since "Python authoritative, TS still computed for
comparison" catches a regression the same way shadow did, just now with
real consequences if it's wrong. Ramping percentages (1-5% -> 25% -> 50%
-> 100%) and their own gating criteria are a separate decision to make
once shadow has actually cleared the exit criteria above, not a plan to
pre-commit to before there's any real production data.

## Running it manually

```bash
curl -X POST "https://<deployment>/api/internal/python-compute-shadow?sampleRate=0.15&maxSampleSize=20" \
  -H "x-internal-secret: $INTERNAL_JOB_SECRET"

curl "https://<deployment>/api/internal/python-compute-shadow?sinceDays=14" \
  -H "x-internal-secret: $INTERNAL_JOB_SECRET"
```

See the README's routes table for the full GET/POST parameter list.
