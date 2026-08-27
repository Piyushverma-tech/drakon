/**
 * Durable persistence for Stage 2 shadow-mode observations
 * (GEOMAGNETIC_STORM_REENTRY_PLAN.md §21). Two new, isolated tables —
 * geomagnetic_shadow_runs and geomagnetic_shadow_object_deltas (see
 * lib/db/schema.ts) — record what evaluateGeomagneticShadow() produced,
 * so shadow-mode output survives past a single HTTP response and can be
 * reviewed later (calibration analysis, storm review, sanity checks).
 *
 * This file is the ONLY place that writes or reads these two tables.
 * Nothing in the production risk path (satelliteHelpers.ts,
 * objectTrendRisk.ts, the dashboard, /api/tle) reads from here, and this
 * file never writes to object_trends, tle_history, or any table the
 * production path reads — the isolation is structural, not just a
 * convention to remember.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from './db';
import {
  geomagneticShadowObjectDeltas,
  geomagneticShadowRuns,
} from './db/schema';
import type { GeomagneticShadowSummary } from './geomagneticShadow';

export type ShadowRunSource = 'scheduled' | 'replay';

export type PersistedShadowRun = {
  id: number;
  generatedAt: string;
  source: ShadowRunSource;
  replayLabel: string | null;
  observedAt: string | null;
  kpClass: string | null;
  estimatedAp: number | null;
  activity: number | null;
  freshness: string;
  modelVersion: number;
  solarFluxMultiplier: number;
  geomagneticMultiplier: number;
  combinedMultiplier: number;
  objectsEvaluated: number;
  objectsWithTierChange: number;
};

export type PersistedShadowObjectDelta = {
  id: number;
  runId: number;
  noradId: number;
  solarOnlyDays: number | null;
  solarOnlyTier: string;
  correctedDays: number | null;
  correctedTier: string;
  daysDelta: number | null;
  tierChanged: boolean;
  solarOnlyTipAgreement: string | null;
  correctedTipAgreement: string | null;
};

/**
 * Persist one shadow evaluation: a single run row, plus one delta row per
 * object actually present in summary.changedRows (objects with no
 * multiplier-driven difference are not stored — the whole point of
 * changedRows is that quiet conditions produce zero of them, and that
 * should be reflected as "zero delta rows for this run," not as a wall of
 * unchanged rows). Two inserts; not a transaction spanning anything else
 * in the schema, since nothing else in the schema is involved.
 */
export async function persistGeomagneticShadowRun(
  summary: GeomagneticShadowSummary,
  source: ShadowRunSource,
  replayLabel: string | null = null
): Promise<number> {
  const [run] = await db
    .insert(geomagneticShadowRuns)
    .values({
      generatedAt: new Date(summary.generatedAt),
      source,
      replayLabel,
      observedAt: summary.observedAt ? new Date(summary.observedAt) : null,
      kpClass: summary.kpClass,
      estimatedAp: summary.estimatedAp,
      activity: summary.activity,
      freshness: summary.freshness,
      modelVersion: summary.modelVersion,
      solarFluxMultiplier: summary.solarFluxMultiplier,
      geomagneticMultiplier: summary.geomagneticMultiplier,
      combinedMultiplier: summary.combinedMultiplier,
      objectsEvaluated: summary.objectsEvaluated,
      objectsWithTierChange: summary.objectsWithTierChange,
    })
    .returning({ id: geomagneticShadowRuns.id });

  if (summary.changedRows.length > 0) {
    await db.insert(geomagneticShadowObjectDeltas).values(
      summary.changedRows.map((row) => ({
        runId: run.id,
        noradId: row.satId,
        solarOnlyDays: row.solarOnlyDays,
        solarOnlyTier: row.solarOnlyTier,
        correctedDays: row.correctedDays,
        correctedTier: row.correctedTier,
        daysDelta: row.daysDelta,
        tierChanged: row.tierChanged,
        solarOnlyTipAgreement: row.solarOnlyTipAgreement,
        correctedTipAgreement: row.correctedTipAgreement,
      }))
    );
  }

  return run.id;
}

function toPersistedRun(
  row: typeof geomagneticShadowRuns.$inferSelect
): PersistedShadowRun {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    source: row.source as ShadowRunSource,
    replayLabel: row.replayLabel,
    observedAt: row.observedAt ? row.observedAt.toISOString() : null,
    kpClass: row.kpClass,
    estimatedAp: row.estimatedAp,
    activity: row.activity,
    freshness: row.freshness,
    modelVersion: row.modelVersion,
    solarFluxMultiplier: row.solarFluxMultiplier,
    geomagneticMultiplier: row.geomagneticMultiplier,
    combinedMultiplier: row.combinedMultiplier,
    objectsEvaluated: row.objectsEvaluated,
    objectsWithTierChange: row.objectsWithTierChange,
  };
}

/**
 * Most recent runs, newest first. Optionally filter by source and/or a
 * minimum generatedAt (e.g. "runs from the last 7 days").
 */
export async function listRecentGeomagneticShadowRuns(options?: {
  limit?: number;
  source?: ShadowRunSource;
  since?: Date;
}): Promise<PersistedShadowRun[]> {
  const limit = options?.limit ?? 50;

  const conditions = [];
  if (options?.source) {
    conditions.push(eq(geomagneticShadowRuns.source, options.source));
  }
  if (options?.since) {
    conditions.push(gte(geomagneticShadowRuns.generatedAt, options.since));
  }

  const rows = await db
    .select()
    .from(geomagneticShadowRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(geomagneticShadowRuns.generatedAt))
    .limit(limit);

  return rows.map(toPersistedRun);
}

/** All object-level deltas recorded for one run. */
export async function getGeomagneticShadowRunDeltas(
  runId: number
): Promise<PersistedShadowObjectDelta[]> {
  const rows = await db
    .select()
    .from(geomagneticShadowObjectDeltas)
    .where(eq(geomagneticShadowObjectDeltas.runId, runId));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    noradId: row.noradId,
    solarOnlyDays: row.solarOnlyDays,
    solarOnlyTier: row.solarOnlyTier,
    correctedDays: row.correctedDays,
    correctedTier: row.correctedTier,
    daysDelta: row.daysDelta,
    tierChanged: row.tierChanged,
    solarOnlyTipAgreement: row.solarOnlyTipAgreement,
    correctedTipAgreement: row.correctedTipAgreement,
  }));
}
