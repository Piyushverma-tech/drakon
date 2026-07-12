import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export async function GET() {
  const result = await db.execute<{
    norad_id: number;
    captured_at: string;
    reentry_tier: string;
    decay_signal: string;
    rn: number;
  }>(sql`
    SELECT norad_id, captured_at, reentry_tier, decay_signal, rn
    FROM (
      SELECT
        norad_id,
        captured_at,
        reentry_tier,
        decay_signal,
        ROW_NUMBER() OVER (
          PARTITION BY norad_id ORDER BY captured_at DESC
        ) AS rn
      FROM trend_snapshots
    ) ranked
    WHERE rn <= 2
    ORDER BY norad_id, rn;
  `);

  const changes: Record<
    number,
    { capturedAt: string; reentryTier: string; decaySignal: string }[]
  > = {};

  for (const row of result.rows) {
    const list = changes[row.norad_id] ?? [];
    list.push({
      capturedAt: new Date(row.captured_at).toISOString(),
      reentryTier: row.reentry_tier,
      decaySignal: row.decay_signal,
    });
    changes[row.norad_id] = list;
  }

  return NextResponse.json({ changes });
}
