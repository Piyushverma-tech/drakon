import { buildReentryTrace } from './buildReentryTrace';
import { ObjectTrend, ReentryRisk, TipPrediction } from '@/lib/types';

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
    const trace = buildReentryTrace({
      risk,
      trend,
      isCurrentModelVersion: true,
    });

    expect(trace.verdict.headline).toBe('Re-entry expected in ~9 days');
    expect(trace.verdict.confidenceLine).toBe('76% confidence');
    expect(trace.verdict.tier).toBe('warning');
    expect(trace.computedAt).toBe('2026-07-08T10:45:00.000Z');

    // all three signals agree here -- summary should say so, with the
    // real epoch count and estimate, not a generic sentence
    expect(trace.verdict.summary).toBe(
      'This object is showing sustained orbital decay, with bstar, n-dot, and altitude signals all in agreement. Based on 31 historical epochs, estimated re-entry in approximately 9 days with high confidence.'
    );

    expect(trace.steps.map((s) => s.id)).toEqual([
      'load-history',
      'signal-bstar',
      'signal-ndot',
      'signal-altitude',
      'consensus',
      'tier',
    ]);
    expect(trace.steps.map((s) => s.stage)).toEqual([
      'Load history',
      'Bstar analysis',
      'N-dot analysis',
      'Altitude analysis',
      'Consensus',
      'Verdict',
    ]);
    // no override step -- risk and trend agree
    expect(trace.steps.find((s) => s.id === 'override')).toBeUndefined();
    // isLast is a rendering concern (TraceStep prop), not part of the
    // data -- nothing to assert on it here.
  });

  it('reproduces the reported STARLINK-1547 case: live altitude overrides a stale, less pessimistic trend', () => {
    const trend = makeTrend({
      reentryTier: 'warning',
      estimatedDaysRemaining: 9,
      decayConfidence: 0.76,
      perigeeLatest: 231,
    });

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

    const trace = buildReentryTrace({
      risk,
      trend,
      isCurrentModelVersion: true,
    });

    expect(trace.verdict.tier).toBe('critical');
    expect(trace.verdict.headline).toBe('Re-entry expected in ~1 days');
    expect(trace.verdict.confidenceLine).toBe('High confidence');
    expect(trace.verdict.summary).toBe(
      "This object's live perigee of 172km places it in an active decay regime, ahead of what the trend model has captured. Based on 31 historical epochs, estimated re-entry in approximately 1 days with high confidence."
    );

    const override = trace.steps.find((s) => s.id === 'override');
    expect(override).toBeDefined();
    expect(override?.stage).toBe('Live override');
    expect(override?.claim).toBe(
      'Live altitude data overrides the trend model'
    );
    expect(override?.detail).toBe(
      'trend model: ~9 days (tier warning) — current perigee is more pessimistic'
    );

    expect(trace.steps.map((s) => s.id)).toEqual([
      'load-history',
      'signal-bstar',
      'signal-ndot',
      'signal-altitude',
      'consensus',
      'override',
      'tier',
    ]);
  });

  it('omits the override step when risk and trend agree on tier despite minor day-count differences', () => {
    const trend = makeTrend({
      reentryTier: 'critical',
      estimatedDaysRemaining: 3,
    });
    const risk = makeRisk({ tier: 'critical', estimatedDaysRemaining: 2 });

    const trace = buildReentryTrace({
      risk,
      trend,
      isCurrentModelVersion: true,
    });
    expect(trace.steps.find((s) => s.id === 'override')).toBeUndefined();
  });

  it('uses the caller-provided model freshness instead of assuming the trend is current', () => {
    const trace = buildReentryTrace({
      risk: makeRisk(),
      trend: makeTrend({ trendVersion: 3 }),
      isCurrentModelVersion: false,
    });

    expect(trace.isCurrentModelVersion).toBe(false);
  });

  it('handles a brand new object with no trend row yet -- no load-history step either', () => {
    const risk = makeRisk({
      tier: 'critical',
      estimatedDaysRemaining: 2,
      confidence: 'high',
      source: 'single_epoch',
      decaySignal: 'decaying',
      decayConfidence: undefined,
    });

    const trace = buildReentryTrace({
      risk,
      trend: undefined,
      isCurrentModelVersion: true,
    });

    expect(trace.computedAt).toBeNull();
    expect(trace.verdict.confidenceLine).toBe('High confidence');
    expect(trace.verdict.summary).toContain(
      'Based on live altitude data alone'
    );
    // no trend row at all -- no load-history step (nothing was "loaded"),
    // no signal/consensus breakdown, just the tier step
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

    const trace = buildReentryTrace({
      risk,
      trend,
      isCurrentModelVersion: true,
    });
    expect(trace.verdict.headline).toBe('Maneuver signature detected');
    expect(trace.verdict.summary).toContain('probable maneuver signature');
    expect(trace.steps.find((s) => s.id === 'tier')?.detail).toBe(
      're-entry estimate suppressed'
    );
    expect(trace.steps.find((s) => s.id === 'tier')?.stage).toBe('Verdict');
  });

  it('omits signal/consensus steps when sub-scores have not been persisted yet, but still shows load-history', () => {
    const trend = makeTrend({
      bstarSignalStrength: null,
      ndotSignalStrength: null,
      altitudeSignalStrength: null,
      consensusRequired: null,
      consensusMet: null,
    });
    const risk = makeRisk();

    const trace = buildReentryTrace({
      risk,
      trend,
      isCurrentModelVersion: true,
    });
    // a trend row exists (even if sub-scores aren't persisted yet), so
    // load-history is real and shown -- only the per-signal breakdown is
    // withheld, not fabricated as zeros
    expect(trace.steps.map((s) => s.id)).toEqual(['load-history', 'tier']);
  });
});

// TIP comparison step tests
function makeTip(overrides: Partial<TipPrediction> = {}): TipPrediction {
  return {
    noradId: 46347,
    decayEpoch: '2026-07-17T00:00:00.000Z',
    windowMinutes: 120,
    msgEpoch: '2026-07-16T00:00:00.000Z',
    insertEpoch: '2026-07-16T00:06:00.000Z',
    direction: 'descending',
    lat: 0,
    lon: 0,
    highInterest: false,
    ...overrides,
  };
}

describe('buildReentryTrace — TIP comparison step', () => {
  it('omits the step entirely when there is no TIP prediction', () => {
    const risk = makeRisk({ tip: undefined });
    const trace = buildReentryTrace({
      risk,
      trend: makeTrend(),
      isCurrentModelVersion: true,
    });
    expect(trace.steps.find((s) => s.id === 'tip-comparison')).toBeUndefined();
  });

  it('flags disagreement with an alert-triangle when DRAKON reports stable despite an active TIP prediction', () => {
    const risk = makeRisk({
      tier: 'stable',
      estimatedDaysRemaining: null,
      tip: makeTip(),
      tipDeltaDays: null,
      tipAgreement: null,
    });
    const trace = buildReentryTrace({
      risk,
      trend: undefined,
      isCurrentModelVersion: true,
    });
    const step = trace.steps.find((s) => s.id === 'tip-comparison');
    expect(step?.icon).toBe('alert-triangle');
    expect(step?.status).toBe('disagree');
    expect(step?.claim).toBe('USSPACECOM TIP predicts near-term decay');
  });

  it('shows shield-check / agree when DRAKON and TIP align', () => {
    const risk = makeRisk({
      tier: 'warning',
      estimatedDaysRemaining: 9,
      tip: makeTip(),
      tipDeltaDays: 2,
      tipAgreement: 'aligned',
    });
    const trace = buildReentryTrace({
      risk,
      trend: makeTrend(),
      isCurrentModelVersion: true,
    });
    const step = trace.steps.find((s) => s.id === 'tip-comparison');
    expect(step?.icon).toBe('shield-check');
    expect(step?.status).toBe('agree');
  });

  it('shows shield-x / disagree when DRAKON and TIP diverge, and is positioned before the tier step', () => {
    const risk = makeRisk({
      tier: 'warning',
      estimatedDaysRemaining: 9,
      tip: makeTip(),
      tipDeltaDays: 20,
      tipAgreement: 'diverges',
    });
    const trace = buildReentryTrace({
      risk,
      trend: makeTrend(),
      isCurrentModelVersion: true,
    });
    const ids = trace.steps.map((s) => s.id);
    const step = trace.steps.find((s) => s.id === 'tip-comparison');
    expect(step?.icon).toBe('shield-x');
    expect(step?.status).toBe('disagree');
    expect(ids.indexOf('tip-comparison')).toBeLessThan(ids.indexOf('tier'));
  });
});
