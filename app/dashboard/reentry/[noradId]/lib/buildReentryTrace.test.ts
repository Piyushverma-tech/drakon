import { buildReentryTrace } from './buildReentryTrace';
import { ObjectTrend, ReentryRisk } from '@/lib/types';

function makeTrend(overrides: Partial<ObjectTrend> = {}): ObjectTrend {
  return {
    noradId: 46347,
    updatedAt: '2026-07-08T10:45:00.000Z',
    trendVersion: 4,
    epochsAvailable: 31,
    historyDaysAvailable: 29,
    bstarLatest: 5e-7,
    bstarSlope7d: null,
    bstarSlope14d: null,
    bstarSlope30d: null,
    bstarMean14d: null,
    bstarStddev14d: null,
    bstarRsq14d: null,
    perigeeLatest: 231,
    perigeeSlope7d: null,
    perigeeSlope14d: null,
    perigeeSlope30d: null,
    apogeeLatest: null,
    apogeeSlope14d: null,
    smaLatest: null,
    smaSlope7d: null,
    smaSlope14d: null,
    meanMotionDotLatest: null,
    meanMotionDotMean14d: null,
    decaySignal: 'decaying',
    maneuverLikelihood: 0,
    decayConfidence: 0.76,
    bstarSignalStrength: 0.55,
    ndotSignalStrength: 0.72,
    altitudeSignalStrength: 0.96,
    consensusRequired: 'partial',
    consensusMet: true,
    estimatedDaysRemaining: 9,
    estimatedReentryAt: '2026-07-17T00:00:00.000Z',
    reentryTier: 'warning',
    objectType: 'payload',
    isDebris: false,
    ...overrides,
  };
}

function makeRisk(overrides: Partial<ReentryRisk> = {}): ReentryRisk {
  return {
    satId: 46347,
    bstar: 5e-7,
    meanMotionDot: 0.00002,
    signalsAgree: true,
    confidence: 'high',
    perigeeKm: 231,
    decayAltKm: 231,
    decayRateKmPerDay: 3.2,
    estimatedDaysRemaining: 9,
    tier: 'warning',
    source: 'multi_epoch',
    decaySignal: 'decaying',
    decayConfidence: 0.76,
    ...overrides,
  };
}

describe('buildReentryTrace', () => {
  it('builds a full trace when the trend model itself is the source of truth', () => {
    const trend = makeTrend();
    const risk = makeRisk();
    const trace = buildReentryTrace({ risk, trend });

    expect(trace.verdict.headline).toBe('Re-entry expected in ~9 days');
    expect(trace.verdict.confidenceLine).toBe('76% confidence');
    expect(trace.verdict.tier).toBe('warning');
    expect(trace.computedAt).toBe('2026-07-08T10:45:00.000Z');

    expect(trace.steps.map((s) => s.id)).toEqual([
      'signal-bstar',
      'signal-ndot',
      'signal-altitude',
      'consensus',
      'tier',
    ]);
    // no override step -- risk and trend agree
    expect(trace.steps.find((s) => s.id === 'override')).toBeUndefined();
  });

  it('reproduces the reported STARLINK-1547 case: live altitude overrides a stale, less pessimistic trend', () => {
    // Trend last computed ~3 days ago, before the object had decayed this
    // far: warning / ~9 days / 76% confidence (matches the reported
    // Analysis page screenshot).
    const trend = makeTrend({
      reentryTier: 'warning',
      estimatedDaysRemaining: 9,
      decayConfidence: 0.76,
      perigeeLatest: 231,
    });

    // resolveReentryRisk(), given the live TLE (perigee 172km): altitude
    // override wins -- critical / ~1 day (matches the reported Detail
    // Panel screenshot). decayConfidence is intentionally absent here --
    // the altitude path doesn't compute one.
    const risk = makeRisk({
      tier: 'critical',
      estimatedDaysRemaining: 1,
      perigeeKm: 172,
      decayAltKm: 172,
      decayRateKmPerDay: 28.93,
      confidence: 'high',
      source: 'single_epoch',
      decaySignal: 'decaying',
      decayConfidence: undefined,
    });

    const trace = buildReentryTrace({ risk, trend });

    // Verdict reflects the live/authoritative risk, not the stale trend.
    expect(trace.verdict.tier).toBe('critical');
    expect(trace.verdict.headline).toBe('Re-entry expected in ~1 days');
    // No decayConfidence on the altitude path -- falls back to the
    // confidence label, never a fabricated percentage.
    expect(trace.verdict.confidenceLine).toBe('High confidence');
    expect(trace.verdict.callout).toBe(
      'Perigee 172km — driven by live altitude data, not the trend model'
    );

    // The disagreement is explicit and specific, not silently swapped.
    const override = trace.steps.find((s) => s.id === 'override');
    expect(override).toBeDefined();
    expect(override?.claim).toBe(
      'Live altitude data overrides the trend model'
    );
    expect(override?.detail).toBe(
      'trend model: ~9 days (tier warning) — current perigee is more pessimistic'
    );

    // Signal/consensus steps from the trend are still shown -- they're
    // still real, useful context, just not the final verdict.
    expect(trace.steps.map((s) => s.id)).toEqual([
      'signal-bstar',
      'signal-ndot',
      'signal-altitude',
      'consensus',
      'tier',
      'override',
    ]);
  });

  it('omits the override step when risk and trend agree on tier despite minor day-count differences', () => {
    const trend = makeTrend({
      reentryTier: 'critical',
      estimatedDaysRemaining: 3,
    });
    const risk = makeRisk({ tier: 'critical', estimatedDaysRemaining: 2 });

    const trace = buildReentryTrace({ risk, trend });
    expect(trace.steps.find((s) => s.id === 'override')).toBeUndefined();
  });

  it('handles a brand new object with no trend row yet', () => {
    const risk = makeRisk({
      tier: 'critical',
      estimatedDaysRemaining: 2,
      confidence: 'high',
      source: 'single_epoch',
      decaySignal: 'decaying',
      decayConfidence: undefined,
    });

    const trace = buildReentryTrace({ risk, trend: undefined });

    expect(trace.computedAt).toBeNull();
    expect(trace.verdict.confidenceLine).toBe('High confidence');
    // no signal/consensus breakdown without a trend row -- just the tier step
    expect(trace.steps.map((s) => s.id)).toEqual(['tier']);
  });

  it('suppresses the re-entry estimate and explains why for a maneuvering object', () => {
    const risk = makeRisk({
      tier: 'stable',
      estimatedDaysRemaining: null,
      decaySignal: 'maneuvering',
    });
    const trend = makeTrend({
      decaySignal: 'maneuvering',
      reentryTier: 'stable',
      estimatedDaysRemaining: null,
    });

    const trace = buildReentryTrace({ risk, trend });
    expect(trace.verdict.headline).toBe('Maneuver signature detected');
    expect(trace.steps.find((s) => s.id === 'tier')?.detail).toBe(
      're-entry estimate suppressed'
    );
  });

  it('omits signal/consensus steps when sub-scores have not been persisted yet, without fabricating them', () => {
    const trend = makeTrend({
      bstarSignalStrength: null,
      ndotSignalStrength: null,
      altitudeSignalStrength: null,
      consensusRequired: null,
      consensusMet: null,
    });
    const risk = makeRisk();

    const trace = buildReentryTrace({ risk, trend });
    expect(trace.steps.map((s) => s.id)).toEqual(['tier']);
  });
});
