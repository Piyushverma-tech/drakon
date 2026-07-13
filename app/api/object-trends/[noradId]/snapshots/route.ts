import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trendSnapshots } from '@/lib/db/schema';

const MAX_SNAPSHOTS = 20;

export async function GET(
  _request: Request,
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

  const rows = await db
    .select({
      capturedAt: trendSnapshots.capturedAt,
      reentryTier: trendSnapshots.reentryTier,
      decaySignal: trendSnapshots.decaySignal,
      decayConfidence: trendSnapshots.decayConfidence,
      estimatedDaysRemaining: trendSnapshots.estimatedDaysRemaining,
    })
    .from(trendSnapshots)
    .where(eq(trendSnapshots.noradId, noradId))
    .orderBy(desc(trendSnapshots.capturedAt))
    .limit(MAX_SNAPSHOTS);

  return NextResponse.json({
    noradId,
    snapshots: rows.map((row) => ({
      capturedAt: row.capturedAt.toISOString(),
      reentryTier: row.reentryTier,
      decaySignal: row.decaySignal,
      decayConfidence: row.decayConfidence,
      estimatedDaysRemaining: row.estimatedDaysRemaining,
    })),
  });
}
