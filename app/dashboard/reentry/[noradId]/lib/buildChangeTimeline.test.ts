import {
  buildChangeTimeline,
  type ChangeSnapshot,
} from './buildChangeTimeline';

function snap(overrides: Partial<ChangeSnapshot>): ChangeSnapshot {
  return {
    capturedAt: '2026-07-10T00:00:00.000Z',
    reentryTier: 'warning',
    decaySignal: 'decaying',
    decayConfidence: 0.7,
    estimatedDaysRemaining: 9,
    ...overrides,
  };
}

describe('buildChangeTimeline', () => {
  it('renders the oldest snapshot as a first appearance, not a transition', () => {
    const timeline = buildChangeTimeline([
      snap({ capturedAt: '2026-07-05T00:00:00.000Z', reentryTier: 'nominal' }),
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].direction).toBe('first');
    expect(timeline[0].headline).toBe('First recorded as nominal');
  });

  it('detects an escalation between two consecutive snapshots', () => {
    const timeline = buildChangeTimeline([
      snap({
        capturedAt: '2026-07-10T00:00:00.000Z',
        reentryTier: 'critical',
        estimatedDaysRemaining: 1,
      }),
      snap({
        capturedAt: '2026-07-05T00:00:00.000Z',
        reentryTier: 'warning',
        estimatedDaysRemaining: 9,
      }),
    ]);

    expect(timeline[0].direction).toBe('escalated');
    expect(timeline[0].headline).toBe('Escalated from warning to critical');
    expect(timeline[0].detail).toBe('~1 days to re-entry');
    expect(timeline[1].direction).toBe('first');
  });

  it('detects an improvement between two consecutive snapshots', () => {
    const timeline = buildChangeTimeline([
      snap({ capturedAt: '2026-07-10T00:00:00.000Z', reentryTier: 'nominal' }),
      snap({ capturedAt: '2026-07-05T00:00:00.000Z', reentryTier: 'critical' }),
    ]);

    expect(timeline[0].direction).toBe('improved');
    expect(timeline[0].headline).toBe('Improved from critical to nominal');
  });

  it('detects a signal-only (lateral) change when tier is unchanged', () => {
    const timeline = buildChangeTimeline([
      snap({
        capturedAt: '2026-07-10T00:00:00.000Z',
        reentryTier: 'warning',
        decaySignal: 'maneuvering',
      }),
      snap({
        capturedAt: '2026-07-05T00:00:00.000Z',
        reentryTier: 'warning',
        decaySignal: 'decaying',
      }),
    ]);

    expect(timeline[0].direction).toBe('lateral');
    expect(timeline[0].headline).toBe(
      'Signal changed from decaying to maneuvering'
    );
    expect(timeline[0].detail).toContain('tier unchanged (warning)');
  });

  it('handles a null estimatedDaysRemaining without fabricating a number', () => {
    const timeline = buildChangeTimeline([
      snap({
        capturedAt: '2026-07-10T00:00:00.000Z',
        reentryTier: 'stable',
        estimatedDaysRemaining: null,
      }),
    ]);

    expect(timeline[0].detail).toBe('no re-entry estimate');
  });

  it('walks a multi-entry history producing one transition per consecutive pair', () => {
    const timeline = buildChangeTimeline([
      snap({ capturedAt: '2026-07-12T00:00:00.000Z', reentryTier: 'critical' }),
      snap({ capturedAt: '2026-07-10T00:00:00.000Z', reentryTier: 'warning' }),
      snap({ capturedAt: '2026-07-08T00:00:00.000Z', reentryTier: 'nominal' }),
      snap({ capturedAt: '2026-07-05T00:00:00.000Z', reentryTier: 'nominal' }),
    ]);

    expect(timeline.map((t) => t.direction)).toEqual([
      'escalated',
      'escalated',
      'lateral',
      'first',
    ]);
  });
});
