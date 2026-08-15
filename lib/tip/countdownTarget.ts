import type { ReentryRisk } from '@/lib/types';

export type CountdownTarget = {
  targetIso: string;
  label?: string;
  accentClassName?: string;
};

/** DRAKON's own countdown target if it has one (multi-epoch only -- single-epoch
 * never sets estimatedReentryAt); otherwise TIP's, if available. Never both --
 * a DRAKON-native countdown is never pre-empted by a TIP one. */
export function resolveCountdownTarget(
  risk: ReentryRisk
): CountdownTarget | null {
  if (risk.source === 'multi_epoch' && risk.estimatedReentryAt) {
    return { targetIso: risk.estimatedReentryAt };
  }
  if (risk.tip) {
    return {
      targetIso: risk.tip.decayEpoch,
      label: 'TIP predicted re-entry in',
      accentClassName:
        risk.tier === 'critical' ? 'text-red-400/70' : 'text-violet-300/90',
    };
  }
  return null;
}
