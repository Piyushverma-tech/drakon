'use client';

import { useQuery } from '@tanstack/react-query';
import type { SatelliteMetadata } from '@/lib/types';

type MetadataMap = Record<string, SatelliteMetadata>;

async function fetchMetadata(): Promise<MetadataMap> {
  const res = await fetch('/satellite-metadata.json');

  if (!res.ok) {
    throw new Error('Failed to load satellite metadata');
  }

  return res.json();
}

export function useSatelliteMetadata() {
  return useQuery<MetadataMap>({
    queryKey: ['satellite-metadata'],
    queryFn: fetchMetadata,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 48 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useMetadataForSatellite(
  noradId: number | null
): SatelliteMetadata | null {
  const { data } = useSatelliteMetadata();

  if (!noradId || !data) {
    return null;
  }

  return data[String(noradId)] ?? null;
}
