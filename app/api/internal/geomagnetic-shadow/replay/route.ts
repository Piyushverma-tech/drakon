import { NextResponse } from 'next/server';
import {
  buildReplayScenarioFromGfzFixture,
  runGeomagneticShadowReplay,
} from '@/lib/geomagneticShadowReplay';
import { loadCurrentCatalogForShadow } from '@/lib/geomagneticShadowCatalog';
import { persistGeomagneticShadowRun } from '@/lib/geomagneticShadowStore';

/**
 * Repeatable replay path (plan §21 Stage 2): runs the shadow evaluation
 * against a historical Kp/ap scenario — default: the real May 2024
 * Gannon storm, lib/fixtures/gfzHistoricalKpAp.ts — applied to the
 * CURRENT catalog (there is no historical TLE snapshot to replay the
 * catalog itself against), and persists the result as a 'replay' run.
 * Internal/ops-only; completely separate from the scheduled-run endpoint
 * at POST /api/internal/geomagnetic-shadow, and from production scoring.
 *
 * Query params (all optional):
 *   label — replay label to persist (default 'gfz-may-2024-storm')
 *   asOf  — ISO 8601 instant to replay as-of (default: the fixture's
 *           last recorded interval, i.e. the full week resolved)
 */
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const label = searchParams.get('label') ?? 'gfz-may-2024-storm';
  const asOfParam = searchParams.get('asOf');

  let asOfMs: number | undefined;
  if (asOfParam !== null) {
    const parsed = new Date(asOfParam).getTime();
    if (Number.isNaN(parsed)) {
      return NextResponse.json(
        { error: 'asOf must be a valid ISO 8601 timestamp' },
        { status: 400 }
      );
    }
    asOfMs = parsed;
  }

  const catalog = await loadCurrentCatalogForShadow();
  if (!catalog) {
    return NextResponse.json(
      { error: 'No TLE data available yet' },
      { status: 503 }
    );
  }

  let scenario;
  try {
    scenario = buildReplayScenarioFromGfzFixture(label, undefined, asOfMs);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid replay scenario' },
      { status: 400 }
    );
  }

  const summary = runGeomagneticShadowReplay(
    scenario,
    catalog.entries,
    catalog.objectTrendsById,
    catalog.solarFluxMultiplier,
    catalog.tipByNoradId
  );

  const runId = await persistGeomagneticShadowRun(summary, 'replay', scenario.label);

  return NextResponse.json({ runId, ...summary });
}
