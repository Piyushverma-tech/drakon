import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { objectTrends } from '@/lib/db/schema';
import { CURRENT_TREND_VERSION, processTrendJobs } from '@/lib/jobs/computeObjectTrends';
import { and, eq, ne } from 'drizzle-orm';

/** Read-only: trend jobs are drained by cron / internal POST, not this route. */
export async function GET() {
  
  after(async () => {
    await processTrendJobs(50); // smaller batch, this is user-triggered
  });

  const rows = await db
    .select()
    .from(objectTrends)
    .where(
      and(
        eq(objectTrends.trendVersion, CURRENT_TREND_VERSION),
        ne(objectTrends.decaySignal, 'insufficient_data')
      )
    );

  return NextResponse.json({
    trendVersion: CURRENT_TREND_VERSION,
    trends: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      estimatedReentryAt: row.estimatedReentryAt?.toISOString() ?? null,
    })),
  });
}
