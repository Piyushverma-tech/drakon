'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RecentSnapshot } from '@/app/dashboard/reentry/lib/buildTriageBuckets';

interface RecentChangesResponse {
  changes: Record<string, RecentSnapshot[]>;
}

async function fetchRecentChanges(): Promise<RecentChangesResponse> {
  const res = await fetch('/api/object-trends/recent-changes', {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Unable to load recent trend changes.');
  }
  return res.json();
}

export function useRecentTrendChangesQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: ['recent-trend-changes'],
    queryFn: fetchRecentChanges,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const changesByNoradId = useMemo(() => {
    const map = new Map<number, RecentSnapshot[]>();
    if (!query.data) return map;
    for (const [key, snapshots] of Object.entries(query.data.changes)) {
      map.set(Number(key), snapshots);
    }
    return map;
  }, [query.data]);

  return { ...query, changesByNoradId };
}
