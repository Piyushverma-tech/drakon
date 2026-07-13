'use client';

import { useQuery } from '@tanstack/react-query';
import type { ChangeSnapshot } from '@/app/dashboard/reentry/[noradId]/lib/buildChangeTimeline';

interface SnapshotsResponse {
  noradId: number;
  snapshots: ChangeSnapshot[];
}

async function fetchSnapshots(noradId: number): Promise<SnapshotsResponse> {
  const res = await fetch(`/api/object-trends/${noradId}/snapshots`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Unable to load change history.');
  }
  return res.json();
}

export function useObjectSnapshotsQuery(noradId: number) {
  return useQuery({
    queryKey: ['object-snapshots', noradId],
    queryFn: () => fetchSnapshots(noradId),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
