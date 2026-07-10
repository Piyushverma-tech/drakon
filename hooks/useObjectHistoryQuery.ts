'use client';

import { useQuery } from '@tanstack/react-query';
import type { ObjectHistoryEntry } from '@/app/dashboard/reentry/[noradId]/lib/buildReentryChartOptions';

interface ObjectHistoryResponse {
  noradId: number;
  days: number;
  entries: ObjectHistoryEntry[];
}

async function fetchHistory(
  noradId: number,
  days: number
): Promise<ObjectHistoryResponse> {
  const res = await fetch(
    `/api/object-trends/${noradId}/history?days=${days}`,
    { cache: 'no-store' }
  );

  if (!res.ok) {
    throw new Error('Unable to load orbital history.');
  }

  return res.json();
}

export function useObjectHistoryQuery(noradId: number, days = 30) {
  return useQuery({
    queryKey: ['object-history', noradId, days],
    queryFn: () => fetchHistory(noradId, days),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
