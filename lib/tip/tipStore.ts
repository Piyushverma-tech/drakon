import redis from '@/lib/redis';
import { fetchTipPredictions } from './spacetrackTip';
import type { TipPrediction } from '@/lib/types';

export const TIP_REDIS_KEY = 'tip:predictions';
// Refreshed hourly; TTL gives a ~4x dead-man's-switch margin so a stalled
// cron eventually degrades to "no TIP data" rather than serving
// indefinitely-stale decay windows as if live — same reasoning as
// SOLAR_F107_TTL_SECONDS, scaled down because TIP is far more time-sensitive
// near decay.
export const TIP_TTL_SECONDS = 4 * 60 * 60;

export type TipSnapshot = {
  byNoradId: Map<number, TipPrediction>;
  refreshedAt: string | null; // ISO — null only when there's truly no data
};

type StoredEnvelope = {
  predictions: TipPrediction[];
  refreshedAt: string;
};

export async function getTipPredictions(): Promise<TipSnapshot> {
  try {
    const envelope = await redis.get<StoredEnvelope>(TIP_REDIS_KEY);
    if (!envelope) return { byNoradId: new Map(), refreshedAt: null };
    return {
      byNoradId: new Map(envelope.predictions.map((row) => [row.noradId, row])),
      refreshedAt: envelope.refreshedAt,
    };
  } catch {
    return { byNoradId: new Map(), refreshedAt: null };
  }
}

export async function refreshTipPredictionsInRedis(): Promise<{
  count: number;
  refreshedAt: string;
} | null> {
  try {
    const predictions = await fetchTipPredictions();
    const refreshedAt = new Date().toISOString();
    // Full replace, not merge — an object missing from this cycle's fetch
    // means its TIP message was superseded or it already decayed, and a
    // stale leftover entry would be actively misleading here.
    await redis.set(
      TIP_REDIS_KEY,
      { predictions, refreshedAt },
      { ex: TIP_TTL_SECONDS }
    );
    return { count: predictions.length, refreshedAt };
  } catch (err) {
    console.error('[TIP] Refresh failed:', err);
    return null;
  }
}
