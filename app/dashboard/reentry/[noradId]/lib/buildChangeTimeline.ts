export interface ChangeSnapshot {
  capturedAt: string;
  reentryTier: string;
  decaySignal: string;
  decayConfidence: number | null;
  estimatedDaysRemaining: number | null;
}

export type ChangeDirection = 'escalated' | 'improved' | 'lateral' | 'first';

export interface TimelineEntry {
  id: string;
  capturedAt: string;
  direction: ChangeDirection;
  headline: string;
  detail: string;
}

// Lower = more severe.
const TIER_SEVERITY: Record<string, number> = {
  critical: 0,
  warning: 1,
  nominal: 2,
  stable: 3,
};

function daysDetail(estimatedDaysRemaining: number | null): string {
  return estimatedDaysRemaining === null
    ? 'no re-entry estimate'
    : `~${estimatedDaysRemaining} days to re-entry`;
}

export function buildChangeTimeline(
  snapshots: ChangeSnapshot[]
): TimelineEntry[] {
  return snapshots.map((snapshot, index) => {
    const older = snapshots[index + 1];

    if (!older) {
      return {
        id: snapshot.capturedAt,
        capturedAt: snapshot.capturedAt,
        direction: 'first',
        headline: `First recorded as ${snapshot.reentryTier}`,
        detail: daysDetail(snapshot.estimatedDaysRemaining),
      };
    }

    const currentSeverity = TIER_SEVERITY[snapshot.reentryTier] ?? 3;
    const olderSeverity = TIER_SEVERITY[older.reentryTier] ?? 3;

    if (currentSeverity < olderSeverity) {
      return {
        id: snapshot.capturedAt,
        capturedAt: snapshot.capturedAt,
        direction: 'escalated',
        headline: `Escalated from ${older.reentryTier} to ${snapshot.reentryTier}`,
        detail: daysDetail(snapshot.estimatedDaysRemaining),
      };
    }

    if (currentSeverity > olderSeverity) {
      return {
        id: snapshot.capturedAt,
        capturedAt: snapshot.capturedAt,
        direction: 'improved',
        headline: `Improved from ${older.reentryTier} to ${snapshot.reentryTier}`,
        detail: daysDetail(snapshot.estimatedDaysRemaining),
      };
    }

    return {
      id: snapshot.capturedAt,
      capturedAt: snapshot.capturedAt,
      direction: 'lateral',
      headline: `Signal changed from ${older.decaySignal} to ${snapshot.decaySignal}`,
      detail: `tier unchanged (${snapshot.reentryTier}) — ${daysDetail(snapshot.estimatedDaysRemaining)}`,
    };
  });
}
