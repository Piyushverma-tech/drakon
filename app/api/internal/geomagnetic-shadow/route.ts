import { NextResponse } from 'next/server';
import { getGeomagneticState } from '@/lib/geomagneticIndex';
import { evaluateGeomagneticShadow } from '@/lib/geomagneticShadow';
import { loadCurrentCatalogForShadow } from '@/lib/geomagneticShadowCatalog';
import {
  getGeomagneticShadowRunDeltas,
  listRecentGeomagneticShadowRuns,
  persistGeomagneticShadowRun,
  type ShadowRunSource,
} from '@/lib/geomagneticShadowStore';

/**
 * Stage 2 shadow-mode observation (plan §21). Internal/ops-only — not
 * called from the dashboard, not part of the live re-entry screen.
 * Nothing here is read by the production risk path; see
 * lib/geomagneticShadowStore.ts for the isolation note.
 *
 * GET  — read durable history: recent runs, or one run's object deltas.
 * POST — run a LIVE evaluation against the current catalog + current
 *        geomagnetic Redis state, persist it as a 'scheduled' run, and
 *        return it. Idempotent (each call just appends one more run row)
 *        and safe to call on an external schedule — recommended
 *        alongside the geomagnetic-index hourly refresh (plan §15),
 *        matching this repo's existing external-cron pattern (see
 *        README.md's Scheduling row) rather than a schedule defined
 *        inside the application.
 *
 * Replay runs (historical Kp/ap scenarios against the current catalog)
 * are a separate endpoint: POST /api/internal/geomagnetic-shadow/replay.
 */
export const maxDuration = 30;

function checkAuth(req: Request): boolean {
  return req.headers.get('x-internal-secret') === process.env.INTERNAL_JOB_SECRET;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runIdParam = searchParams.get('runId');

  if (runIdParam !== null) {
    const runId = Number(runIdParam);
    if (!Number.isInteger(runId)) {
      return NextResponse.json(
        { error: 'runId must be an integer' },
        { status: 400 }
      );
    }
    const deltas = await getGeomagneticShadowRunDeltas(runId);
    return NextResponse.json({ runId, deltas });
  }

  const sourceParam = searchParams.get('source');
  if (sourceParam !== null && sourceParam !== 'scheduled' && sourceParam !== 'replay') {
    return NextResponse.json(
      { error: "source must be 'scheduled' or 'replay'" },
      { status: 400 }
    );
  }

  const limitParam = searchParams.get('limit');
  const sinceHoursParam = searchParams.get('sinceHours');

  const runs = await listRecentGeomagneticShadowRuns({
    limit: limitParam !== null ? Number(limitParam) : undefined,
    source: (sourceParam as ShadowRunSource | null) ?? undefined,
    since:
      sinceHoursParam !== null
        ? new Date(Date.now() - Number(sinceHoursParam) * 3_600_000)
        : undefined,
  });

  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const catalog = await loadCurrentCatalogForShadow();
  if (!catalog) {
    return NextResponse.json(
      { error: 'No TLE data available yet' },
      { status: 503 }
    );
  }

  const geomagneticState = await getGeomagneticState();

  const summary = evaluateGeomagneticShadow(
    catalog.entries,
    catalog.objectTrendsById,
    catalog.solarFluxMultiplier,
    geomagneticState,
    catalog.tipByNoradId
  );

  const runId = await persistGeomagneticShadowRun(summary, 'scheduled');

  return NextResponse.json({ runId, ...summary });
}
