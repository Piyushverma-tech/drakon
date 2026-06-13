'use client';

import { useQuery } from '@tanstack/react-query';
import type { ObjectTrend } from '@/lib/types';

type ObjectTrendsResponse = {
  trendVersion: number;
  trends: ObjectTrend[];
};

async function fetchObjectTrends(): Promise<Map<number, ObjectTrend>> {
  const res = await fetch('/api/object-trends', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Unable to load object trend data.');
  }

  const data = (await res.json()) as ObjectTrendsResponse;
  return new Map(data.trends.map((trend) => [trend.noradId, trend]));
}

export function useObjectTrendsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['object-trends'],
    queryFn: fetchObjectTrends,
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
