import { NextResponse } from 'next/server';
import { runPartitionMaintenance } from '@/lib/db/tlePartitions';

// This is meant to run monthly via cron-job.org -- every step is idempotent (CREATE TABLE
// IF NOT EXISTS / DROP TABLE IF EXISTS).
export const maxDuration = 60;

export async function POST(req: Request) {
  const configuredSecret = process.env.INTERNAL_JOB_SECRET;

  if (!configuredSecret) {
    console.error('INTERNAL_JOB_SECRET is not configured');
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const secret = req.headers.get('x-internal-secret');
  if (secret !== configuredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runPartitionMaintenance();
  console.log('[tle_history partitions]', result);
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}
