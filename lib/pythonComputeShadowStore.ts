/**
 * Durable persistence for Python compute shadow evaluations (plan §17
 * Phase 6). Two new, isolated tables -- python_compute_shadow_runs and
 * python_compute_shadow_object_deltas (see lib/db/schema.ts) -- record
 * what evaluatePythonComputeShadow() produced, so shadow-mode output
 * survives past a single HTTP response and can be reviewed later against
 * the exit criteria in docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md.
 *
 * This file is the ONLY place that writes or reads these two tables.
 * Nothing in the production risk path (satelliteHelpers.ts,
 * objectTrendRisk.ts, the dashboard, /api/tle) reads from here, and this
 * file never writes to object_trends, tle_history, or any table the
 * production path reads -- the isolation is structural, matching
 * lib/geomagneticShadowStore.ts's pattern exactly, not a new convention.
 */
import { desc, eq, gte } from 'drizzle-orm';
import { db } from './db';
import {
  pythonComputeShadowObjectDeltas,
  pythonComputeShadowRuns,
} from './db/schema';
import type { PythonComputeShadowSummary } from './pythonComputeShadow';

export type PersistedPythonComputeShadowRun = {
  id: number;
  generatedAt: string;
  expectedModelId: string;
  expectedModelVersion: string;
  catalogSize: number;
  eligibleCount: number;
  sampledCount: number;
  successCount: number;
  matchedCount: number;
  valueMismatchCount: number;
  failureCount: number;
  failuresByType: Record<string, number>;
  durationMsP50: number | null;
  durationMsP95: number | null;
  durationMsP99: number | null;
  sampleRate: number;
  maxSampleSize: number;
};

export type PersistedPythonComputeShadowDelta = {
  id: number;
  runId: number;
  noradId: number;
  requestId: string;
  durationMs: number;
  pythonFailureType: string | null;
  differenceCount: number;
  differences: unknown;
  tsTier: string;
  pythonTier: string | null;
};

/**
 * Persist one shadow evaluation: a single run row, plus one delta row per
 * object actually present in summary.rows (objects that matched are not
 * stored -- see evaluatePythonComputeShadow's rows doc). Two inserts; not
 * a transaction spanning anything else in the schema, since nothing else
 * in the schema is involved.
 */
export async function persistPythonComputeShadowRun(
  summary: PythonComputeShadowSummary
): Promise<number> {
  const [run] = await db
    .insert(pythonComputeShadowRuns)
    .values({
      generatedAt: new Date(summary.generatedAt),
      expectedModelId: summary.expectedModelId,
      expectedModelVersion: summary.expectedModelVersion,
      catalogSize: summary.catalogSize,
      eligibleCount: summary.eligibleCount,
      sampledCount: summary.sampledCount,
      successCount: summary.successCount,
      matchedCount: summary.matchedCount,
      valueMismatchCount: summary.valueMismatchCount,
      failureCount: summary.failureCount,
      failuresByType: summary.failuresByType,
      durationMsP50: summary.durationMsP50,
      durationMsP95: summary.durationMsP95,
      durationMsP99: summary.durationMsP99,
      sampleRate: summary.sampleRate,
      maxSampleSize: summary.maxSampleSize,
    })
    .returning({ id: pythonComputeShadowRuns.id });

  if (summary.rows.length > 0) {
    await db.insert(pythonComputeShadowObjectDeltas).values(
      summary.rows.map((row) => ({
        runId: run.id,
        noradId: row.noradId,
        requestId: row.requestId,
        durationMs: row.durationMs,
        pythonFailureType: row.pythonFailureType,
        differenceCount: row.differenceCount,
        differences: row.differences,
        tsTier: row.tsTier,
        pythonTier: row.pythonTier,
      }))
    );
  }

  return run.id;
}

function toPersistedRun(
  row: typeof pythonComputeShadowRuns.$inferSelect
): PersistedPythonComputeShadowRun {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    expectedModelId: row.expectedModelId,
    expectedModelVersion: row.expectedModelVersion,
    catalogSize: row.catalogSize,
    eligibleCount: row.eligibleCount,
    sampledCount: row.sampledCount,
    successCount: row.successCount,
    matchedCount: row.matchedCount,
    valueMismatchCount: row.valueMismatchCount,
    failureCount: row.failureCount,
    failuresByType: row.failuresByType as Record<string, number>,
    durationMsP50: row.durationMsP50,
    durationMsP95: row.durationMsP95,
    durationMsP99: row.durationMsP99,
    sampleRate: row.sampleRate,
    maxSampleSize: row.maxSampleSize,
  };
}

/** Most recent runs, newest first. Optionally filter by a minimum
 * generatedAt (e.g. "runs from the last 14 days" for a rollout review). */
export async function listRecentPythonComputeShadowRuns(options?: {
  limit?: number;
  since?: Date;
}): Promise<PersistedPythonComputeShadowRun[]> {
  const limit = options?.limit ?? 50;

  const rows = await db
    .select()
    .from(pythonComputeShadowRuns)
    .where(options?.since ? gte(pythonComputeShadowRuns.generatedAt, options.since) : undefined)
    .orderBy(desc(pythonComputeShadowRuns.generatedAt))
    .limit(limit);

  return rows.map(toPersistedRun);
}

/** All object-level deltas recorded for one run. */
export async function getPythonComputeShadowRunDeltas(
  runId: number
): Promise<PersistedPythonComputeShadowDelta[]> {
  const rows = await db
    .select()
    .from(pythonComputeShadowObjectDeltas)
    .where(eq(pythonComputeShadowObjectDeltas.runId, runId));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    noradId: row.noradId,
    requestId: row.requestId,
    durationMs: row.durationMs,
    pythonFailureType: row.pythonFailureType,
    differenceCount: row.differenceCount,
    differences: row.differences,
    tsTier: row.tsTier,
    pythonTier: row.pythonTier,
  }));
}

/**
 * Aggregate rollup across a set of runs -- the numbers
 * docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md's exit criteria are actually
 * evaluated against (e.g. "≥10,000 successful comparisons over the last
 * 14 days"), rather than requiring a human to sum per-run numbers by hand.
 */
export async function summarizePythonComputeShadowWindow(
  since: Date
): Promise<{
  runCount: number;
  totalSampled: number;
  totalSuccess: number;
  totalMatched: number;
  totalValueMismatch: number;
  totalFailure: number;
  failuresByType: Record<string, number>;
}> {
  const runs = await listRecentPythonComputeShadowRuns({ since, limit: 100000 });

  const acc = {
    runCount: runs.length,
    totalSampled: 0,
    totalSuccess: 0,
    totalMatched: 0,
    totalValueMismatch: 0,
    totalFailure: 0,
    failuresByType: {} as Record<string, number>,
  };

  for (const run of runs) {
    acc.totalSampled += run.sampledCount;
    acc.totalSuccess += run.successCount;
    acc.totalMatched += run.matchedCount;
    acc.totalValueMismatch += run.valueMismatchCount;
    acc.totalFailure += run.failureCount;
    for (const [type, count] of Object.entries(run.failuresByType)) {
      acc.failuresByType[type] = (acc.failuresByType[type] ?? 0) + count;
    }
  }

  return acc;
}
