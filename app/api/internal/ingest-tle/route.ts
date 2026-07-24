import { NextResponse } from 'next/server';
import { runIngestionCycle } from '@/lib/ingestion/tleIngestionService';

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

  const result = await runIngestionCycle();
  return NextResponse.json({ ...result, timestamp: new Date().toISOString() });
}
