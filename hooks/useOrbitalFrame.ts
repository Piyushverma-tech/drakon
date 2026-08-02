'use client';

import { useEffect, useState } from 'react';
import { computeOrbitalState, OrbitalFrame } from '@/lib/orbitalFrame';

type Options = {
  /** TLE line 1/2 for the object to track. Pass null/undefined when nothing is selected. */
  l1?: string | null;
  l2?: string | null;
  /**
   * How often to re-propagate and recompute the vectors, in ms. A single
   * SGP4 call is cheap (no worker needed, unlike full orbit-path
   * generation), so this can stay short. Default matches MiniGlobe's
   * position refresh cadence for a consistent "live" feel.
   */
  updateIntervalMs?: number;
};

/**
 * Live orbital-frame (radial/velocity/orbit-normal vectors + flight-path
 * angle) for a single TLE, re-propagated on an interval.
 *
 * Use this in contexts that only have raw TLE lines (e.g. the re-entry
 * analysis page's `TleEntry`). Contexts that already build a
 * `SelectedMeta` (the globe's left panel) get `orbitalFrame` for free
 * from `buildSelectedMeta` and don't need this hook.
 */
export function useOrbitalFrame({
  l1,
  l2,
  updateIntervalMs = 5000,
}: Options): { orbitalFrame: OrbitalFrame | null } {
  const [orbitalFrame, setOrbitalFrame] = useState<OrbitalFrame | null>(null);

  useEffect(() => {
    if (!l1 || !l2) {
      setOrbitalFrame(null);
      return;
    }

    const recompute = () => {
      setOrbitalFrame(computeOrbitalState(l1, l2, new Date()));
    };

    recompute();
    const timer = window.setInterval(recompute, updateIntervalMs);
    return () => window.clearInterval(timer);
  }, [l1, l2, updateIntervalMs]);

  return { orbitalFrame };
}
