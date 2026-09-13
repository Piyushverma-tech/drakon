# DRAKON Compute Engine

Private FastAPI service for server-side scientific models. Full rationale:
`docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md`.

## What this is (and isn't) yet

`/health`, `/models`, and `POST /compute/reentry` exist. `/compute/reentry`
is backed by `resolve_reentry_risk()` (`compute/reentry.py`), the ported
and golden-fixture-parity-tested Re-entry Resolution Model -- Phases 1-4 of
the re-entry migration sequence (plan §17) are done. It's still wired up as
`reentry_resolution` / status `"experimental"` in `compute/registry.py`:
shadow-mode comparison against the live TypeScript `resolveReentryRisk()`
(Phase 6+) hasn't run yet, and no Next.js code calls this route in
production.

No other `/compute/*` routes exist. Each one gets added only once a real
model function backs it -- see `compute/reentry.py`'s pattern for what
"done" looks like before a route is worth adding.

### Response shape: every /compute/* route returns an envelope, not a naked result

```json
{
  "result": { "...": "the actual model output, e.g. ReentryRiskModel" },
  "model": {
    "id": "reentry_resolution",
    "version": "0.1.0",
    "parameterSet": "reentry-2026-09-baseline",
    "calibrationVersion": null
  },
  "engine": { "version": "0.1.0" }
}
```

Decided now, not after Next.js starts depending on a naked result shape --
see `contracts.py`'s `ComputeResponse`. `model` is real result provenance
(traceable to the registry entry that produced it), not just service
metadata duplicated from `/models`. `calibrationVersion` is `null` until
there's an actual calibration step to version; the field exists so adding
one later doesn't change the response shape.

### Input contracts are scientific-model-shaped, not persistence-model-shaped

`contracts.py`'s `ReentryComputeEntry` / `ReentryComputeTrend` are
deliberately NOT mirrors of `lib/types.ts`'s `TleEntry` (~16 fields) /
`ObjectTrend` (~30 fields) -- they only declare the 8 and 17 fields
`resolve_reentry_risk()` actually reads. `ObjectTrend` is an application
persistence model; `ReentryComputeInput` is a scientific model input, and
should stay stable even when the database schema grows a new column. The
Next.js caller (Phase 6) maps its own `TleEntry`/`ObjectTrend` records down
to this narrower shape before calling -- that mapping lives entirely on
the Next.js side.

### Environmental input boundary (read before touching solar/geomagnetic anything)

`solarFluxMultiplier` is currently the *only* environmental input this
model accepts -- one pre-composed atmospheric-density multiplier.
Geomagnetic-correction work is happening in parallel on the TS side; once
it lands, the intended future input boundary is
`solarFluxMultiplier x geomagneticCorrection -> re-entry model`, as two
separate named fields instead of one pre-multiplied number.

**That decomposition is not implemented here, and shouldn't be until this
model has full parity with its TS reference** (Phase 5/6 -- shadow mode
against the live TS `resolveReentryRisk()`). When it does land, it's a
model-version bump, not a silent field addition:

- `0.1.0` -- this port. Exact migration of the existing TS model.
- `0.2.0` -- geomagnetic-aware model.

See `compute/registry.py`'s docstring for the authoritative version
history.

## Boundary rule: this service does not know it's on Vercel

- `main.py` and `contracts.py` may know about HTTP/FastAPI/Pydantic. They
  must never read `BACKEND_URL`, reference "service bindings", "rewrites",
  or any other Vercel-specific concept. That knowledge belongs entirely to
  the Next.js caller.
- `compute/*.py` may not import FastAPI or Pydantic contracts at all. Every
  function there takes and returns plain Python (dict/dataclass), and must
  be callable and testable with zero knowledge of how it's deployed.

Why: the escape hatch this project wants is

```
Next.js
   |
   | stable HTTP contract
   v
Compute interface (a small TS client -- lands with Phase 6)
   |
   +-- Vercel Service today (backend/, via BACKEND_URL)
   |
   +-- conventional Python Function / separate service later
```

If `compute/` code ever mentions Vercel, that escape hatch is gone --
moving off Services would mean rewriting the model, not just redeploying
it. Keeping the model layer deployment-agnostic is what makes "add another
Python service later" or "move this off Services" a config change instead
of a rewrite.

## Boundary rule: TypeScript fits, Python interprets

`compute/reentry_trend.py` interprets `RegressionResult` objects
(slope/rSquared/mean/stddev/n) that TypeScript already computed --
`regression()` / `weightedRegression()` in `lib/jobs/computeObjectTrends.ts`
fit the actual OLS regression over each object's TLE history, and that
stays in TypeScript (plan §11). Nothing in `compute/` fits a regression
from raw history; it only classifies and scores regression results it's
handed. Worth stating explicitly here because "the trend logic was
migrated to Python" is an easy thing to believe six months from now if
this boundary isn't written down somewhere obvious.

## Local development

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn main:app --reload --port 8000
```

## Deployment topology

Declared in `/vercel.json`. This service (`compute-engine`) has no entry in
the top-level `rewrites` list, so it receives no public traffic -- Vercel
Services are private by default and only become public when a rewrite
targets them. The `web` (Next.js) service reaches it via a `bindings` entry
that injects `BACKEND_URL` as an internal-network URL at runtime.
`compute-engine`'s own runtime config (currently just `maxDuration`) is
declared inside its own service block in `vercel.json`, not as a top-level
`functions` key -- each service in the Services model configures its
compute independently, the same way a standalone Vercel project would.

One manual step this repo can't encode: in Vercel's Project Settings ->
Build and Deployment, the project Framework must be set to **Services**
for `vercel.json`'s `services` key to take effect at all.

## Golden fixtures: reproducibility and baseline integrity

`fixtures/reentry-model/golden_cases.json` is generated, never hand-edited,
by `scripts/generate-reentry-golden-fixtures.ts`. Its `baselineCommit`
field is auto-derived at generation time from the most recent commit that
touched the reference TS source files (`git log -1 -- <those files>`, not
`git rev-parse HEAD` -- see the generator script for why that distinction
matters). It was previously a hardcoded literal -- a real staleness bug,
since fixed -- and the generator refuses to run against uncommitted
changes to the reference TS source files unless `--allow-dirty` is passed. `lib/reentryModel.goldenFixtures.baseline.test.ts` is a CI guard
that regenerates into a scratch file and diffs it against the committed
fixture (ignoring only the timestamp) -- it fails if the fixture is stale
relative to current source, or if `baselineCommit` (or anything else) was
hand-edited.
