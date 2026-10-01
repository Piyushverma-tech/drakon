'use client';

import { useQuery } from '@tanstack/react-query';
import type { ObjectTrendDashboardRow } from '@/lib/types';

type ObjectTrendsResponse = {
  trendVersion: number;
  trends: ObjectTrendDashboardRow[];
};

async function fetchObjectTrends(): Promise<Map<number, ObjectTrendDashboardRow>> {
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
