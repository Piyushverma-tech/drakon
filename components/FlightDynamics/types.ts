import type { OrbitalFrame } from '@/lib/orbitalFrame';

export type FlightDynamicsCanvasProps = {
  /** Null while no satellite is selected, or if SGP4 propagation failed. */
  orbitalFrame: OrbitalFrame | null;
  className?: string;
  emptyMessage?: string;
  /** Fixed pixel height for the canvas; width fills the container. */
  heightPx?: number;
  /** Small "N nadir · V velocity · H orbit normal" caption below the canvas. Default true. */
  showLegend?: boolean;
};
