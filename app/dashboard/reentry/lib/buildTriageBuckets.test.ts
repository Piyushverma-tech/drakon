import { ReentryRisk } from '@/lib/types';
import { buildTriageBuckets, type RecentSnapshot } from './buildTriageBuckets';

const NOW = Date.UTC(2026, 6, 12, 12, 0, 0); // 2026-07-12T12:00:00Z

function makeRisk(overrides: Partial<ReentryRisk> = {}): ReentryRisk {
  return {
    satId: 1,
    bstar: 5e-7,
    meanMotionDot: 0.00002,
    signalsAgree: true,
    confidence: 'high',
    perigeeKm: 300,
    decayAltKm: 300,
    decayRateKmPerDay: 1,
    estimatedDaysRemaining: 30,
    tier: 'warning',
    source: 'multi_epoch',
    ...overrides,
  };
}

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 60 * 60 * 1000).toISOString();
}

function snapshot(overrides: Partial<RecentSnapshot>): RecentSnapshot {
  return {
    capturedAt: hoursAgo(1),
    reentryTier: 'warning',
    decaySignal: 'decaying',
    ...overrides,
  };
}

describe('buildTriageBuckets', () => {
  it('puts an object with no snapshot history into active/watching by current tier alone', () => {
    const critical = makeRisk({ satId: 1, tier: 'critical' });
    const nominal = makeRisk({ satId: 2, tier: 'nominal' });

    const result = buildTriageBuckets([critical, nominal], new Map(), NOW);

    expect(result.active.map((r) => r.satId)).toEqual([1]);
    expect(result.watching.map((r) => r.satId)).toEqual([2]);
    expect(result.newEscalated).toHaveLength(0);
  });

  it('treats a first-ever snapshot within the recent window as a new appearance', () => {
    const risk = makeRisk({ satId: 1, tier: 'critical' });
    const changes = new Map([
      [1, [snapshot({ capturedAt: hoursAgo(2), reentryTier: 'critical' })]],
    ]);

    const result = buildTriageBuckets([risk], changes, NOW);
    expect(result.newEscalated.map((r) => r.satId)).toEqual([1]);
  });

  it('flags a recent tier escalation (warning -> critical) as new/escalated', () => {
    const risk = makeRisk({ satId: 1, tier: 'critical' });
    const changes = new Map([
      [
        1,
        [
          snapshot({ capturedAt: hoursAgo(5), reentryTier: 'critical' }),
          snapshot({ capturedAt: hoursAgo(200), reentryTier: 'warning' }),
        ],
      ],
    ]);

    const result = buildTriageBuckets([risk], changes, NOW);
    expect(result.newEscalated.map((r) => r.satId)).toEqual([1]);
  });

  it('does not flag a recent improvement (critical -> warning) as new/escalated', () => {
    const risk = makeRisk({ satId: 1, tier: 'warning' });
    const changes = new Map([
      [
        1,
        [
          snapshot({ capturedAt: hoursAgo(5), reentryTier: 'warning' }),
          snapshot({ capturedAt: hoursAgo(200), reentryTier: 'critical' }),
        ],
      ],
    ]);

    const result = buildTriageBuckets([risk], changes, NOW);
    expect(result.newEscalated).toHaveLength(0);
    // still elevated (warning) -> active, not watching
    expect(result.active.map((r) => r.satId)).toEqual([1]);
  });

  it('does not flag a signal-only change with no tier move as new/escalated', () => {
    const risk = makeRisk({ satId: 1, tier: 'warning' });
    const changes = new Map([
      [
        1,
        [
          snapshot({
            capturedAt: hoursAgo(5),
            reentryTier: 'warning',
            decaySignal: 'maneuvering',
          }),
          snapshot({
            capturedAt: hoursAgo(200),
            reentryTier: 'warning',
            decaySignal: 'decaying',
          }),
        ],
      ],
    ]);

    const result = buildTriageBuckets([risk], changes, NOW);
    expect(result.newEscalated).toHaveLength(0);
    expect(result.active.map((r) => r.satId)).toEqual([1]);
  });

  it('settles an old escalation (outside the recent window) into active, not new/escalated', () => {
    const risk = makeRisk({ satId: 1, tier: 'critical' });
    const changes = new Map([
      [
        1,
        [
          snapshot({ capturedAt: hoursAgo(200), reentryTier: 'critical' }),
          snapshot({ capturedAt: hoursAgo(400), reentryTier: 'warning' }),
        ],
      ],
    ]);

    const result = buildTriageBuckets([risk], changes, NOW);
    expect(result.newEscalated).toHaveLength(0);
    expect(result.active.map((r) => r.satId)).toEqual([1]);
  });

  it('sorts a mixed set of objects into all three buckets correctly', () => {
    const rows = [
      makeRisk({ satId: 1, tier: 'critical' }), // no history -> active
      makeRisk({ satId: 2, tier: 'nominal' }), // no history -> watching
      makeRisk({ satId: 3, tier: 'critical' }), // recent escalation -> new_escalated
    ];
    const changes = new Map([
      [
        3,
        [
          snapshot({ capturedAt: hoursAgo(1), reentryTier: 'critical' }),
          snapshot({ capturedAt: hoursAgo(50), reentryTier: 'nominal' }),
        ],
      ],
    ]);

    const result = buildTriageBuckets(rows, changes, NOW);
    expect(result.newEscalated.map((r) => r.satId)).toEqual([3]);
    expect(result.active.map((r) => r.satId)).toEqual([1]);
    expect(result.watching.map((r) => r.satId)).toEqual([2]);
  });
});
