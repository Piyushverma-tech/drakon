import { ReentryRisk } from '@/lib/types';

export type TriageBucket = 'new_escalated' | 'active' | 'watching';

export interface RecentSnapshot {
  capturedAt: string;
  reentryTier: string;
  decaySignal: string;
}

export interface TriageResult {
  newEscalated: ReentryRisk[];
  active: ReentryRisk[];
  watching: ReentryRisk[];
}

const RECENT_WINDOW_MS = 72 * 60 * 60 * 1000;

// tier order
const TIER_SEVERITY: Record<string, number> = {
  critical: 0,
  warning: 1,
  nominal: 2,
  stable: 3,
};

function classify(
  risk: ReentryRisk,
  snapshots: RecentSnapshot[] | undefined,
  nowMs: number
): TriageBucket {
  const isElevated = risk.tier === 'critical' || risk.tier === 'warning';
  const fallback: TriageBucket = isElevated ? 'active' : 'watching';

  if (!snapshots || snapshots.length === 0) return fallback;

  const [latest, previous] = snapshots;
  const isRecent =
    nowMs - new Date(latest.capturedAt).getTime() < RECENT_WINDOW_MS;
  if (!isRecent) return fallback;

  // A recent change with nothing before it in the log is a genuinely new
  // appearance in the flagged catalog -- always worth surfacing.
  if (!previous) return 'new_escalated';

  const latestSeverity = TIER_SEVERITY[latest.reentryTier] ?? 3;
  const previousSeverity = TIER_SEVERITY[previous.reentryTier] ?? 3;
  const escalated = latestSeverity < previousSeverity;

  return escalated ? 'new_escalated' : fallback;
}

export function buildTriageBuckets(
  rows: ReentryRisk[],
  changesByNoradId: Map<number, RecentSnapshot[]>,
  nowMs: number = Date.now()
): TriageResult {
  const result: TriageResult = { newEscalated: [], active: [], watching: [] };

  for (const risk of rows) {
    const bucket = classify(risk, changesByNoradId.get(risk.satId), nowMs);
    if (bucket === 'new_escalated') result.newEscalated.push(risk);
    else if (bucket === 'active') result.active.push(risk);
    else result.watching.push(risk);
  }

  return result;
}
