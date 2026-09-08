# Re-entry model golden fixtures

`golden_cases.json` is the frozen reference for the re-entry model's
migration from TypeScript to Python (plan §17, Phase 1). It is **generated,
never hand-edited** — see `scripts/generate-reentry-golden-fixtures.ts`.

## What's in it

The generator imports the real production TypeScript functions (not
hand-derived expected values) across four layers and records whatever they
actually return for a set of representative inputs:

- `primitives` — `lib/satelliteHelpers.ts`'s pure functions (`parseBSTAR`,
  `getReentryTierThresholds`, `assignReentryTier`, `applyConfidenceCeiling`,
  `altitudeBasedReentryEstimate`, `ndotIndicatesDecay`, `getReentryRisk`).
- `reentryTrendHelpers` — the individual sub-functions inside
  `lib/explainReentryTrend.ts` and `lib/reentrySignals.ts`'s
  `allSignalsAgreeFromSlopes`, isolated so a future mismatch is diagnosable
  at the sub-function level.
- `explainReentryTrend` — that module's top-level function, end-to-end.
- `resolveReentryRisk` — `lib/objectTrendRisk.ts`'s top-level function,
  end-to-end.

Both the TypeScript freeze tests (`lib/reentryModel.goldenFixtures.test.ts`)
and the Python parity tests (`backend/tests/test_*_golden_fixtures.py`)
assert against this same file, so a real behavioral difference between the
two implementations always shows up as a test failure on whichever side
hasn't caught up yet.

## Regenerating

```bash
npx tsx scripts/generate-reentry-golden-fixtures.ts
```

Two fields describe provenance, both resolved automatically:

- `generatedAt` — wall-clock time of generation. Expected to change on
  every run; ignored by the baseline-integrity check below.
- `baselineCommit` — auto-derived from `git rev-parse HEAD`. The generator
  **refuses to run** if `lib/satelliteHelpers.ts`, `lib/explainReentryTrend.ts`,
  `lib/reentrySignals.ts`, or `lib/objectTrendRisk.ts` have uncommitted
  changes, since a baseline label is meaningless if the files it's supposed
  to describe don't match it yet. Commit first, or pass `--allow-dirty` for
  deliberate local iteration before committing.

Override either with `--out=<path>` / `GOLDEN_FIXTURES_OUT`, or
`--baseline-commit=<sha>` / `BASELINE_COMMIT`.

## If you deliberately change the reference model

1. Change the TypeScript source in `lib/`.
2. Commit it.
3. Regenerate: `npx tsx scripts/generate-reentry-golden-fixtures.ts`.
4. Record why here — a short dated note is enough:

   <!-- Add entries above this line, newest first. -->

5. Update the Python port in `backend/compute/` to match, and treat this as
   a real model-version bump (`backend/compute/registry.py`) if the change
   affects `reentry_resolution`'s actual behavior, not just its
   implementation.

Don't hand-edit `golden_cases.json` to make a failing test pass. If a test
is failing because you changed the reference implementation on purpose,
regenerate for real; if it's failing for any other reason, that's the bug
the fixture exists to catch.

## Baseline integrity is enforced, not just documented

`lib/reentryModel.goldenFixtures.baseline.test.ts` regenerates into a
scratch file and diffs it against the committed fixture (ignoring only
`generatedAt`). It fails if the committed file is stale relative to current
source, or if anything in it — including `baselineCommit` — was hand-edited
or forgotten during a regeneration. This runs as part of the normal TS test
suite; there's no separate step to remember.
