import { processTrendJobs } from '@/lib/jobs/computeObjectTrends';
import { NextResponse } from 'next/server';

function isAuthorized(req: Request): boolean {
  const secret = req.headers.get('x-internal-secret');
  if (secret && secret === process.env.INTERNAL_JOB_SECRET) return true;

  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  return false;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchSize = Number(searchParams.get('batchSize') ?? 100);
  const processed = await processTrendJobs(
    Number.isFinite(batchSize) ? Math.max(1, Math.min(500, batchSize)) : 100
  );

  return NextResponse.json({ processed });
}

// Vercel Cron invokes GET by default.
export async function GET(req: Request) {
  return POST(req);
}
