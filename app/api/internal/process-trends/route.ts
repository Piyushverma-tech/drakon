import { db } from '@/lib/db';
import { processTrendJobs } from '@/lib/jobs/computeObjectTrends';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const maxDuration = 60; // seconds

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchSize = parseInt(searchParams.get('batchSize') || '200');

  // Reset jobs stuck in processing
  await db.execute(sql`
    UPDATE trend_jobs
    SET status = 'pending', error_message = 'reset: stuck in processing'
    WHERE status = 'processing'
      AND created_at < NOW() - INTERVAL '60 minutes'
  `);

  const processed = await processTrendJobs(batchSize);
  return NextResponse.json({ processed, timestamp: new Date().toISOString() });
}
