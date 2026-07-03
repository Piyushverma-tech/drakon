import {
  explainReentryTrend,
  type RegressionResult,
} from './explainReentryTrend';

function reg(
  overrides: Partial<NonNullable<RegressionResult>>
): RegressionResult {
  return {
    slope: 0,
    rSquared: 0,
    mean: 1,
    stddev: 0,
    n: 8,
    ...overrides,
  };
}

const nowMs = Date.UTC(2026, 0, 1);

describe('explainReentryTrend', () => {
  it('blocks active payload re-entry when full consensus is required and not met', () => {
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 2e-7, rSquared: 0.9 }),
      ndotReg: reg({ slope: 0, rSquared: 0.9 }),
      perigeeReg: reg({ slope: -0.3, rSquared: 0.8 }),
      perigeeReg7d: reg({ slope: -0.3, rSquared: 0.8 }),
      smaReg: reg({ slope: -0.3, rSquared: 0.8 }),
      smaReg7d: reg({ slope: -0.3, rSquared: 0.8 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 400,
      objectType: 'payload',
      perigeeLatest: 400,
      nowMs,
    });

    expect(explanation.signal).toBe('decaying');
    expect(explanation.consensus).toEqual({ required: 'full', met: false });
    expect(explanation.reentry.reentryTier).toBe('stable');
    expect(explanation.reentry.estimatedDaysRemaining).toBeNull();
  });

  it('uses partial consensus in the 220-300km altitude band, and applies the confidence ceiling to the resulting tier', () => {
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 0, rSquared: 0.9 }),
      ndotReg: reg({ slope: 0, rSquared: 0.9 }),
      perigeeReg: reg({ slope: -1, rSquared: 0.9 }),
      perigeeReg7d: reg({ slope: -1, rSquared: 0.9 }),
      smaReg: reg({ slope: 0, rSquared: 0.9 }),
      smaReg7d: reg({ slope: 0, rSquared: 0.9 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 260,
      objectType: 'payload',
      perigeeLatest: 260,
      nowMs,
    });

    expect(explanation.consensus).toEqual({ required: 'partial', met: true });
    expect(explanation.signal).toBe('decaying');
    expect(explanation.decayConfidence).toBeCloseTo(0.36, 10);
    expect(explanation.reentry.estimatedDaysRemaining).toBe(94);
    // Raw tier from assignReentryTier(94, 260) is 'warning', but 0.36
    // confidence is below the 0.75 ceiling, and perigee (260) is above the
    // sub-220km bypass threshold, so applyConfidenceCeiling downgrades it.
    expect(explanation.reentry.reentryTier).toBe('nominal');
  });

  it('marks likely maneuvers and suppresses the re-entry estimate', () => {
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 2e-7, rSquared: 0.9, mean: 1, stddev: 2 }),
      ndotReg: reg({ slope: 2e-5, rSquared: 0.9 }),
      perigeeReg: reg({ slope: 0, rSquared: 0.8 }),
      perigeeReg7d: reg({ slope: 0, rSquared: 0.8 }),
      smaReg: reg({ slope: 0, rSquared: 0.8 }),
      smaReg7d: reg({ slope: 0, rSquared: 0.8 }),
      ndotLatest: 0.0001,
      ndotMean14d: 0.0001,
      decayAltKm: 400,
      objectType: 'debris',
      perigeeLatest: 400,
      nowMs,
    });

    expect(explanation.signal).toBe('maneuvering');
    expect(explanation.maneuverLikelihood).toBeGreaterThan(0.5);
    expect(explanation.reentry.reentryTier).toBe('stable');
    expect(explanation.reentry.estimatedDaysRemaining).toBeNull();
  });

  it('reports the exact signal weight split used for decay confidence', () => {
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 5e-8, rSquared: 1 }),
      ndotReg: reg({ slope: 5e-6, rSquared: 1 }),
      perigeeReg: reg({ slope: -0.25, rSquared: 1 }),
      perigeeReg7d: reg({ slope: -0.25, rSquared: 1 }),
      smaReg: reg({ slope: 0, rSquared: 1 }),
      smaReg7d: reg({ slope: 0, rSquared: 1 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 350,
      objectType: 'debris',
      perigeeLatest: 350,
      nowMs,
    });

    expect(explanation.signals.map((signal) => signal.weight)).toEqual([
      0.35, 0.25, 0.4,
    ]);
    expect(explanation.signals.map((signal) => signal.strength)).toEqual([
      0.5, 0.5, 0.5,
    ]);
    expect(explanation.decayConfidence).toBeCloseTo(0.5, 10);
  });

  it('keeps insufficient evidence as insufficient data', () => {
    const explanation = explainReentryTrend({
      bstarReg: null,
      ndotReg: null,
      perigeeReg: null,
      perigeeReg7d: null,
      smaReg: null,
      smaReg7d: null,
      ndotLatest: null,
      ndotMean14d: null,
      decayAltKm: 0,
      objectType: 'unknown',
      perigeeLatest: null,
      nowMs,
    });

    expect(explanation.signal).toBe('insufficient_data');
    expect(explanation.decayConfidence).toBe(0);
    expect(explanation.consensus).toEqual({ required: 'full', met: false });
    expect(explanation.reentry.decayRateKmPerDay).toBeNull();
  });

  it('classifies as stable when regressions show no decay but history is long enough to trust', () => {
    // Distinct from "insufficient_data": here we have n=8 valid epochs that
    // all agree on "nothing is happening", not an absence of data.
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 0, rSquared: 0, n: 8 }),
      ndotReg: reg({ slope: 0, rSquared: 0 }),
      perigeeReg: reg({ slope: 0, rSquared: 0 }),
      perigeeReg7d: reg({ slope: 0, rSquared: 0 }),
      smaReg: reg({ slope: 0, rSquared: 0 }),
      smaReg7d: reg({ slope: 0, rSquared: 0 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 500,
      objectType: 'payload',
      perigeeLatest: 500,
      nowMs,
    });

    expect(explanation.signal).toBe('stable');
    // classifyDecaySignal floors decayConfidence at 0.8 for the stable path.
    expect(explanation.decayConfidence).toBe(0.8);
    expect(explanation.reentry.reentryTier).toBe('stable');
    expect(explanation.reentry.estimatedDaysRemaining).toBeNull();
  });

  it('requires no signal consensus below 220km, where altitude alone is decisive', () => {
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 0, rSquared: 0 }), // bstar disagrees
      ndotReg: reg({ slope: 0, rSquared: 0 }), // ndot disagrees
      perigeeReg: reg({ slope: -2, rSquared: 0.9 }),
      perigeeReg7d: reg({ slope: -2, rSquared: 0.9 }),
      smaReg: reg({ slope: -2, rSquared: 0.9 }),
      smaReg7d: reg({ slope: -2, rSquared: 0.9 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 180,
      objectType: 'payload',
      perigeeLatest: 180,
      nowMs,
    });

    expect(explanation.consensus).toEqual({ required: 'none', met: true });
    expect(explanation.signal).toBe('decaying');
    expect(explanation.reentry.estimatedDaysRemaining).not.toBeNull();
  });

  it('bypasses the confidence ceiling below 220km, keeping the raw tier undowngraded', () => {
    // Same shape of evidence as the "nominal" ceiling-downgrade case above,
    // just moved below 220km. Confidence is still only ~0.36 -- normally
    // ceiling-capped to 'nominal' -- but the sub-220km bypass in
    // estimateReentry uses the raw tier directly when maneuverLikelihood is 0.
    const explanation = explainReentryTrend({
      bstarReg: reg({ slope: 0, rSquared: 0.9 }),
      ndotReg: reg({ slope: 0, rSquared: 0.9 }),
      perigeeReg: reg({ slope: -1, rSquared: 0.9 }),
      perigeeReg7d: reg({ slope: -1, rSquared: 0.9 }),
      smaReg: reg({ slope: 0, rSquared: 0.9 }),
      smaReg7d: reg({ slope: 0, rSquared: 0.9 }),
      ndotLatest: 0,
      ndotMean14d: 0,
      decayAltKm: 180,
      objectType: 'payload',
      perigeeLatest: 180,
      nowMs,
    });

    expect(explanation.decayConfidence).toBeCloseTo(0.36, 10);
    expect(explanation.maneuverLikelihood).toBe(0);
    // rawTier from assignReentryTier(estimatedDays, 180) is 'warning'.
    // applyConfidenceCeiling would downgrade 'warning' -> 'nominal' at this
    // confidence (same as the 260km case above) -- below 220km it doesn't,
    // so the bypass keeps it at the un-downgraded 'warning'.
    expect(explanation.reentry.reentryTier).toBe('warning');
  });
});
