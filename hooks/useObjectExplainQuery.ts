'use client';

import { useQuery } from '@tanstack/react-query';
import type { SignalContribution } from '@/lib/explainReentryTrend';

export interface ReentryExplainResponse {
  noradId: number;
  updatedAt: string;
  trendVersion: number;
  isCurrentModelVersion: boolean;
  signalsPersisted: boolean;
  signal: 'decaying' | 'stable' | 'maneuvering' | 'insufficient_data';
  decayConfidence: number | null;
  maneuverLikelihood: number | null;
  signals: SignalContribution[];
  consensus: {
    required: 'full' | 'partial' | 'none' | null;
    met: boolean | null;
  };
  reentry: {
    estimatedDaysRemaining: number | null;
    estimatedReentryAt: string | null;
    reentryTier: 'critical' | 'warning' | 'nominal' | 'stable';
  };
  dataQuality: {
    epochsAvailable: number | null;
    historyDaysAvailable: number | null;
    perigeeLatest: number | null;
    apogeeLatest: number | null;
  };
}

async function fetchExplain(noradId: number): Promise<ReentryExplainResponse> {
  const res = await fetch(`/api/object-trends/${noradId}/explain`, {
    cache: 'no-store',
  });

  if (res.status === 404) {
    throw new Error(`No trend data for object ${noradId}.`);
  }
  if (!res.ok) {
    throw new Error('Unable to load the decision trace.');
  }

  return res.json();
}

export function useObjectExplainQuery(noradId: number) {
  return useQuery({
    queryKey: ['object-explain', noradId],
    queryFn: () => fetchExplain(noradId),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
