import type { TleEntry } from '@/lib/types';

export type RgbaColor = [number, number, number, number];

export type MiniGlobeMarker = {
  id?: string | number;
  lat: number;
  lon: number;
  altKm: number;
  color?: RgbaColor;
  radiusMeters?: number;
};

export type MiniGlobeProps = {
  entry?: TleEntry | null;
  markers?: MiniGlobeMarker[];
  orbitColor?: RgbaColor;
  satelliteColor?: RgbaColor;
  showOrbit?: boolean;
  orbitSamples?: number;
  flyToZoom?: number;
  emptyMessage?: string;
  className?: string;
};
