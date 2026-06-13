import { sql } from 'drizzle-orm';
import { db } from '../db';
import { objectTrends, trendJobs } from '../db/schema';
import { CURRENT_TREND_VERSION } from './computeObjectTrends';

export async function requeueStaleObjects(): Promise<number> {
  const stale = await db
    .select({ noradId: objectTrends.noradId })
    .from(objectTrends)
    .where(sql`${objectTrends.trendVersion} < ${CURRENT_TREND_VERSION}`);

  if (!stale.length) return 0;

  // Insert pending jobs, skip if already queued
  await db
    .insert(trendJobs)
    .values(stale.map((r) => ({ noradId: r.noradId })))
    .onConflictDoNothing(); // partial unique index on (norad_id) WHERE pending

  return stale.length;
}
