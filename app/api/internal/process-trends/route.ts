import { db } from '@/lib/db';
import { trendJobs } from '@/lib/db/schema';
import { processTrendJobs } from '@/lib/jobs/computeObjectTrends';
import { eq } from 'drizzle-orm';
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
  await db.delete(trendJobs).where(eq(trendJobs.status, 'processing'));

  const processed = await processTrendJobs(batchSize);
  return NextResponse.json({ processed, timestamp: new Date().toISOString() });
}
