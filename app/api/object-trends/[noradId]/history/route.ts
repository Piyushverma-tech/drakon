import { NextResponse } from 'next/server';
import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tleHistory } from '@/lib/db/schema';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/**
 * Raw per-epoch orbital history for one object — feeds the Analysis page's
 * altitude decay / BSTAR trend charts directly. Read-only; history is
 * written by the TLE ingest pipeline, not this route.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ noradId: string }> }
) {
  const { noradId: noradIdParam } = await params;
  const noradId = Number(noradIdParam);

  if (!Number.isInteger(noradId) || noradId <= 0) {
    return NextResponse.json(
      { error: 'noradId must be a positive integer' },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get('days'));
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(daysParam, MAX_DAYS)
      : DEFAULT_DAYS;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      epoch: tleHistory.epoch,
      bstar: tleHistory.bstar,
      meanMotion: tleHistory.meanMotion,
      meanMotionDot: tleHistory.meanMotionDot,
      perigeeKm: tleHistory.perigeeKm,
      apogeeKm: tleHistory.apogeeKm,
      semiMajorAxisKm: tleHistory.semiMajorAxisKm,
    })
    .from(tleHistory)
    .where(and(eq(tleHistory.noradId, noradId), gte(tleHistory.epoch, since)))
    .orderBy(asc(tleHistory.epoch));

  return NextResponse.json({
    noradId,
    days,
    entries: rows.map((row) => ({
      epochMs: row.epoch.getTime(),
      bstar: row.bstar,
      meanMotion: row.meanMotion,
      meanMotionDot: row.meanMotionDot,
      perigeeKm: row.perigeeKm,
      apogeeKm: row.apogeeKm,
      semiMajorAxisKm: row.semiMajorAxisKm,
    })),
  });
}
