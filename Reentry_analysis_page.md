# Re-entry Analysis Page — Implementation Plan

Scope: extract a shared explainability core from the existing trend worker, persist a
snapshot history, expose two new API routes, build the Analysis page with Apache
ECharts, rework the Dashboard's default sort into triage buckets, and change the
`ReentryDetailPanel` entry point.

Sequenced so every later phase is built on data that's already real and tested —
no phase ships a chart against a number that gets redefined later.

---

## Phase 0 — Extract `explainReentryTrend()` (pure refactor, no schema change)

**Problem:** `classifyDecaySignal()` and `estimateReentry()` currently live inside
`lib/jobs/computeObjectTrends.ts` (lines 201–253 and 275–366) and are only ever
called from `recomputeTrends()` (line 636). Their intermediate values —
`bstarSig`, `ndotSig`, `altSig`, which thresholds cleared or missed — never leave
that function scope. Only the final `decayConfidence` number gets persisted to
`object_trends`. The Analysis page cannot show "why" without either duplicating
this math client-side (drift risk) or having the worker persist more than it
currently does.

**Move to a new file:** `lib/explainReentryTrend.ts`

Extract these functions verbatim from `lib/jobs/computeObjectTrends.ts`:

| Function                    | Current location | Action                            |
| --------------------------- | ---------------- | --------------------------------- |
| `bstarSignalStrength`       | line 150         | move                              |
| `ndotSignalStrength`        | line 155         | move                              |
| `altitudeSignalStrength`    | line 171         | move                              |
| `computeManeuverLikelihood` | line 189         | move                              |
| `classifyDecaySignal`       | line 201         | move, extend return shape (below) |
| `payloadConsensusRequired`  | line 255         | move                              |
| `partialConsensusRequired`  | line 271         | move                              |
| `estimateReentry`           | line 275         | move, extend return shape (below) |

`computeObjectTrends.ts` keeps `regression`, `weightedRegression`,
`slopeOverWindowWeighted`, `buildTrendSet`, `upsertTrend`, `processTrendJobs`,
`recomputeTrends` — everything that's specifically about _fetching and
persisting_, not about _judging_. It imports the moved functions from
`lib/explainReentryTrend.ts` instead of defining them.

**Extend the return shape.** Today `classifyDecaySignal` returns
`{ signal, maneuverLikelihood, decayConfidence }` — the three inputs
(`bstarSig`, `ndotSig`, `altSig`) are computed and discarded. New shape:

```ts
// lib/explainReentryTrend.ts

export interface SignalContribution {
  name: 'bstar' | 'ndot' | 'altitude';
  strength: number; // 0-1, the raw signal value already computed today
  weight: number; // 0.35 / 0.25 / 0.4 — the real weights, not display-only
  contribution: number; // strength * weight
  agrees: boolean; // did this signal individually clear its threshold
}

export interface ReentryExplanation {
  signal: DecaySignal;
  decayConfidence: number;
  maneuverLikelihood: number;
  signals: SignalContribution[]; // always length 3
  consensus: { required: 'full' | 'partial' | 'none'; met: boolean };
  reentry: {
    estimatedDaysRemaining: number | null;
    estimatedReentryAt: Date | null;
    reentryTier: ReentryTier;
    decayRateKmPerDay: number | null;
  };
}

export function explainReentryTrend(input: {
  bstarReg: RegressionResult;
  ndotReg: RegressionResult;
  perigeeReg: RegressionResult; // 14d
  perigeeReg7d: RegressionResult;
  smaReg: RegressionResult; // 14d
  smaReg7d: RegressionResult;
  ndotLatest: number | null;
  ndotMean14d: number | null;
  decayAltKm: number;
  objectType: ObjectType;
  perigeeLatest: number | null;
  nowMs: number;
}): ReentryExplanation;
```

This single function replaces the two separate calls at
`computeObjectTrends.ts:636` and `:645`. Internally it's still
`classifyDecaySignal` followed by `estimateReentry` — same math, same
thresholds, same weights (0.35/0.25/0.4) — just returning the intermediate
values instead of throwing them away, and merged into one call so the worker
and the API can never accidentally call them out of sync or with mismatched
arguments.

**Call site change in `recomputeTrends()` (around line 636):**

```ts
// before
const { signal, maneuverLikelihood, decayConfidence } = classifyDecaySignal(...)
const reentry = estimateReentry(...)

// after
const explanation = explainReentryTrend({
  bstarReg: bstar14d, ndotReg: ndot14d, perigeeReg: perigee14d,
  perigeeReg7d: perigee7d, smaReg: sma14d, smaReg7d: sma7d,
  ndotLatest: latest.meanMotionDot, ndotMean14d, decayAltKm,
  objectType, perigeeLatest: latest.perigeeKm, nowMs: now,
});
```

`upsertTrend()`'s payload updates to pull from `explanation.*` instead of the
old destructured locals — same fields, same table, no schema change yet.

**New persisted columns on `object_trends`** (small, additive migration):

```ts
// lib/db/schema.ts — add to objectTrends table
bstarSignalStrength: real('bstar_signal_strength'),
ndotSignalStrength: real('ndot_signal_strength'),
altitudeSignalStrength: real('altitude_signal_strength'),
consensusRequired: text('consensus_required'), // 'full' | 'partial' | 'none'
consensusMet: boolean('consensus_met'),
```

Without these, the Analysis page's "why" section would have to recompute
`explainReentryTrend()` on every request by re-fetching 30 days of
`tle_history` and re-running regressions — fine for one object on demand, but
it means the value shown in the UI is derived at read-time from possibly
slightly different regression windows than what actually drove the tier
assignment at write-time. Persisting the three sub-scores makes the
explanation exactly match the decision that was made, not a live
recomputation of it. Cheap columns, real correctness win.

`objectTrendToReentryRisk()` in `lib/objectTrendRisk.ts` (line 163) is
unaffected — it already reads from the persisted `ObjectTrend` row, just gains
three more optional fields it can pass through to `ReentryRisk` if useful
later.

**Tests:** `lib/explainReentryTrend.test.ts` — this is the highest-leverage
test in the codebase to add, since it's the thing the Analysis page's
credibility rests on. Cover: full consensus required and not met → stable;
partial consensus at 220–300km altitude band; maneuvering override
(`maneuverLikelihood > 0.5`); the exact weight split (0.35/0.25/0.4) sums
`decayConfidence` correctly; insufficient data path. Follow the existing
pattern in `lib/satelliteHelpers.test.ts` / `lib/solarFlux.test.ts`.

**Effort:** ~half a day. Zero behavior change — output values are identical,
only the shape returned is richer. Safe to ship on its own before anything
else in this doc.

---

## Phase 1 — `trend_snapshots` table

**Why now, not deferred:** the Dashboard's job is "what needs attention right
now," which requires knowing what changed since the last check. Without a
history of past estimates, "attention" degrades into "sorted by tier," which
is what the page already does today. This table is what the Dashboard and
Analysis page's "track record" section both need — earlier in the sequence
than a nice-to-have.

```ts
// lib/db/schema.ts
export const trendSnapshots = pgTable(
  'trend_snapshots',
  {
    id: serial('id').primaryKey(),
    noradId: integer('norad_id').notNull(),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
    reentryTier: text('reentry_tier').notNull(),
    decayConfidence: real('decay_confidence'),
    estimatedDaysRemaining: integer('estimated_days_remaining'),
    decaySignal: text('decay_signal'),
  },
  (table) => ({
    noradIdx: index('trend_snapshots_norad_idx').on(
      table.noradId,
      table.capturedAt
    ),
  })
);
```

Written once per object at the end of `recomputeTrends()`, right after
`upsertTrend()`, only when the tier or `decaySignal` actually changed since
the previous snapshot for that `noradId` — no point appending an identical
row every cron run. Query the most recent snapshot first (cheap, indexed),
compare, insert only on change.

```
npm run db:generate   # drizzle-kit generate — writes drizzle/000X_*.sql
npm run db:migrate
```

**Effort:** ~2–3 hours including the change-detection guard.

---

## Phase 2 — API routes

### `app/api/object-trends/[noradId]/history/route.ts` (new)

Returns raw `tle_history` rows for one object, last 30 days, ordered by
epoch — feeds the ECharts time series directly. Mirrors the existing query
shape already used in `recomputeTrends()` (`computeObjectTrends.ts:506-520`),
just scoped to a single `noradId` instead of driving a batch job.

```ts
GET /api/object-trends/25544/history?days=30
→ { noradId, entries: [{ epochMs, bstar, meanMotion, meanMotionDot, perigeeKm, apogeeKm, semiMajorAxisKm }] }
```

### `app/api/object-trends/[noradId]/explain/route.ts` (new)

Returns the persisted `ObjectTrend` row plus the three sub-scores and
consensus fields from Phase 0, formatted as a `ReentryExplanation`. This does
**not** re-run `explainReentryTrend()` — it reads what was persisted at the
last `recomputeTrends()` run, so what the Analysis page shows is guaranteed
to match what actually drove the current tier. If the row predates the Phase
0 migration (nulls in the new columns), fall back to recomputing from
`tle_history` on demand and flag the response as `derived: true` — this only
matters for objects that haven't had a fresh recompute since the columns were
added, and disappears after one cron cycle.

### `app/api/object-trends/[noradId]/snapshots/route.ts` (new)

Returns `trend_snapshots` rows for one object — powers the Analysis page's
track-record section and, later, the Dashboard's "escalated since last check"
bucket.

---

## Phase 3 — ECharts wrapper

Package already in `package.json` (`recharts` currently unused anywhere in
the codebase — swap intent, no new dependency risk). Add `echarts` alongside
it, then remove `recharts` once nothing references it.

```
npm install echarts
```

**One reusable wrapper, not one-off chart components:**

```tsx
// components/charts/EChart.tsx
'use client';
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  GridComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export function EChart({
  option,
  height = 320,
}: {
  option: echarts.EChartsCoreOption;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, {
      renderer: 'canvas',
    });
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ height, width: '100%' }} />;
}
```

Explicit `echarts/core` + registered components only, not the full bundle —
keeps this well under the ~1MB full-import cost. This component is reusable
for maneuvers/collision charts later; it's the actual deliverable of this
phase, not the individual chart configs.

`app/dashboard/reentry/[noradId]/page.tsx` renders `EChart` via
`next/dynamic` with `ssr: false`, same pattern already used for
`MiniGlobe`/deck.gl.

**Effort:** ~1 day for the wrapper + first chart (altitude decay with
`markLine` thresholds); each additional chart (BSTAR log-scale, drag
regression overlay) is incremental once the wrapper exists.

---

## Phase 4 — Analysis page

Route: `app/dashboard/reentry/[noradId]/page.tsx`

Structure follows the "why is this decaying, how did DRAKON reach this
conclusion" framing — an argument, not a stats grid:

```
app/dashboard/reentry/[noradId]/
├── page.tsx                       — server component, fetches trend + entry
├── components/
│   ├── AnalysisHeader.tsx         — verdict: tier, window, confidence, one line
│   ├── SignalBreakdown.tsx        — 3 real signals from ReentryExplanation,
│   │                                 each with cleared/missed threshold — no
│   │                                 4th "history quality" slice
│   ├── AltitudeDecayChart.tsx     — EChart, perigee/apogee/SMA, markLine at
│   │                                 the object's actual computed tier
│   │                                 thresholds (not fixed 250/220/180/120)
│   ├── BstarTrendChart.tsx        — EChart, log-scale axis, regression
│   │                                 overlay from bstarReg
│   ├── TrackRecord.tsx            — trend_snapshots history: has DRAKON been
│   │                                 saying this consistently, or did the
│   │                                 estimate just start moving
│   └── DataProvenance.tsx         — epoch count, TLE age, F10.7, trend
│                                     version (all already in ObjectTrend)
└── hooks/
    ├── useObjectHistoryQuery.ts   — hits /history route
    └── useObjectExplainQuery.ts   — hits /explain route
```

`AnalysisHeader` and `DataProvenance` need no new data — every field is
already in `ObjectTrend`/`TleEntry` as returned by the existing
`ReentryDetailPanel` data flow. `SignalBreakdown` and `TrackRecord` are the
two components that depend on Phase 0 and Phase 1 respectively.

**Threshold lines on the altitude chart:** compute per-object dynamically
from `assignReentryTier`'s actual day-based bands mapped back to an
altitude/day estimate for that object's current decay rate, rather than
drawing static 250/220/180/120 km lines that don't correspond to how tiering
actually works. If that mapping isn't worth the effort short-term, shade the
current tier's _day_ threshold as a vertical `markLine` on the x-axis instead
of fabricating altitude bands — accurate to the model, and arguably clearer.

---

## Phase 5 — Dashboard triage rework

`app/dashboard/reentry/components/ReentryScreeningPage.tsx` and
`ReentryTable.tsx` — default sort changes from flat tier order to three
buckets, using `trend_snapshots`:

1. **New / escalated** — tier worsened or `decayConfidence` crossed a
   threshold since the previous snapshot.
2. **Active critical** — sustained critical/warning tier, no recent change.
3. **Watching** — nominal/warning, stable.

Implementation: a `useObjectTrendsQuery`-adjacent hook joins the current
`object_trends` cache against each object's latest two `trend_snapshots`
rows (or a single query with `LATERAL` / window function server-side if the
table grows large — fine to start with an in-memory diff given current
catalog size, revisit if it doesn't scale). This is additive to the existing
list/table components, not a rewrite of them.

---

## Phase 6 — Entry point change

`app/dashboard/reentry/components/ReentryDetailPanel.tsx`, lines 175–182:

```tsx
// before
<Link href="/globe" onClick={onOpenGlobe} className="...text-cyan-400...">
  Open globe <ExternalLink className="h-3 w-3" />
</Link>

// after
<div className="flex items-center gap-3">
  <Link
    href={`/dashboard/reentry/${risk.satId}`}
    className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-cyan-400 hover:text-cyan-300 shrink-0"
  >
    Full analysis <ArrowRight className="h-3 w-3" />
  </Link>
  <Link
    href="/globe"
    onClick={onOpenGlobe}
    aria-label="Open globe"
    className="text-gray-500 hover:text-gray-300 shrink-0"
  >
    <ExternalLink className="h-3 w-3" />
  </Link>
</div>
```

Full analysis is the primary action; globe becomes a secondary icon-only
affordance next to it, not a peer button. `onOpenGlobe` prop stays as-is —
only the JSX and the primary link target change.

---

## Suggested order of work

| Phase                                  | Depends on  | Ships independently?             |
| -------------------------------------- | ----------- | -------------------------------- |
| 0 — `explainReentryTrend()` extraction | —           | Yes, zero behavior change        |
| 1 — `trend_snapshots`                  | —           | Yes, additive migration          |
| 2 — API routes                         | Phases 0, 1 | Yes, once 0/1 land               |
| 3 — EChart wrapper                     | —           | Yes, parallel to 0/1/2           |
| 4 — Analysis page                      | Phases 2, 3 | The visible deliverable          |
| 5 — Dashboard triage                   | Phase 1     | Can ship before or after Phase 4 |
| 6 — Entry point                        | Phase 4     | Last — needs the route to exist  |

Phases 0, 1, and 3 have no dependency on each other and can be done in any
order or in parallel. Everything downstream of them is then built on
persisted, tested data rather than numbers that get redefined once the
schema catches up.
