import { NextResponse } from 'next/server';
import {
  getTipPredictions,
  refreshTipPredictionsInRedis,
} from '@/lib/tip/tipStore';

export async function GET() {
  const { byNoradId, refreshedAt } = await getTipPredictions();
  return NextResponse.json({
    predictions: [...byNoradId.values()],
    refreshedAt,
  });
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await refreshTipPredictionsInRedis();
  if (!result) {
    return NextResponse.json({ error: 'TIP refresh failed' }, { status: 502 });
  }
  return NextResponse.json(result);
}
