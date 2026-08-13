'use client';

import { useQuery } from '@tanstack/react-query';
import type { TipPrediction } from '@/lib/types';

export type TipQueryResult = {
  byNoradId: Map<number, TipPrediction>;
  refreshedAt: string | null;
};

async function fetchTip(): Promise<TipQueryResult> {
  const res = await fetch('/api/tip', { cache: 'no-store' });
  if (!res.ok) throw new Error('Unable to load TIP data.');
  const data = (await res.json()) as {
    predictions: TipPrediction[];
    refreshedAt: string | null;
  };
  return {
    byNoradId: new Map(data.predictions.map((p) => [p.noradId, p])),
    refreshedAt: data.refreshedAt,
  };
}

export function useTipQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['tip-predictions'],
    queryFn: fetchTip,
    enabled,
    staleTime: 20 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000, // matches TIP_TTL_SECONDS
    refetchOnWindowFocus: false,
  });
}
