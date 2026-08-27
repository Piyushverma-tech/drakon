import {
  buildReplayScenarioFromGfzFixture,
  runGeomagneticShadowReplay,
} from './geomagneticShadowReplay';
import { MAX_GEOMAG_MULTIPLIER } from './geomagneticIndex';
import { GFZ_HISTORICAL_KP_AP_MAY_2024 } from './fixtures/gfzHistoricalKpAp';
import type { TleEntry } from './types';

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 25544,
    name: 'TEST DEBRIS',
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6' + ' '.repeat(8),
    l2: '2 25544  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182,
    ecc: 0,
    perigeeKm: 230,
    apogeeKm: 245,
    semiMajorAxisKm: 6565,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
    ...overrides,
  };
}

describe('geomagneticShadowReplay — buildReplayScenarioFromGfzFixture', () => {
  it('defaults asOfMs to the last entry in the fixture', () => {
    const scenario = buildReplayScenarioFromGfzFixture('full-week');
    const lastEntry =
      GFZ_HISTORICAL_KP_AP_MAY_2024[GFZ_HISTORICAL_KP_AP_MAY_2024.length - 1];
    expect(scenario.asOfMs).toBe(new Date(lastEntry.intervalStart).getTime());
  });

  it('carries the label through unchanged', () => {
    const scenario = buildReplayScenarioFromGfzFixture('my-custom-label');
    expect(scenario.label).toBe('my-custom-label');
  });

  it('builds one history observation per fixture entry, using the official ap directly', () => {
    const scenario = buildReplayScenarioFromGfzFixture('full-week');
    expect(scenario.history).toHaveLength(GFZ_HISTORICAL_KP_AP_MAY_2024.length);
    expect(scenario.history[0].estimatedAp).toBe(
      GFZ_HISTORICAL_KP_AP_MAY_2024[0].officialAp
    );
  });

  it('throws on an empty entries array rather than silently producing an empty scenario', () => {
    expect(() => buildReplayScenarioFromGfzFixture('empty', [])).toThrow();
  });
});

describe('geomagneticShadowReplay — runGeomagneticShadowReplay', () => {
  it('replays the real Gannon storm peak and drives the multiplier to its ceiling', () => {
    const peakScenario = buildReplayScenarioFromGfzFixture(
      'gfz-may-2024-storm-peak',
      GFZ_HISTORICAL_KP_AP_MAY_2024,
      new Date('2024-05-11T00:00:00.000Z').getTime()
    );

    const summary = runGeomagneticShadowReplay(
      peakScenario,
      [makeEntry()],
      undefined,
      1.0
    );

    // Empirically verified: at the real historical storm peak (ap 400),
    // the recency-weighted activity is far above threshold and the
    // (uncalibrated placeholder) multiplier saturates at its safety cap.
    expect(summary.estimatedAp).toBe(400);
    expect(summary.geomagneticMultiplier).toBe(MAX_GEOMAG_MULTIPLIER);
    expect(summary.combinedMultiplier).toBeCloseTo(MAX_GEOMAG_MULTIPLIER, 5);
    expect(summary.changedRows.length).toBeGreaterThan(0);
    expect(summary.changedRows[0].tierChanged).toBe(true);
  });

  it('replays a quiet lead-up point and produces no correction at all', () => {
    const quietScenario = buildReplayScenarioFromGfzFixture(
      'gfz-may-2024-quiet-leadup',
      GFZ_HISTORICAL_KP_AP_MAY_2024,
      new Date('2024-05-08T00:00:00.000Z').getTime()
    );

    const summary = runGeomagneticShadowReplay(
      quietScenario,
      [makeEntry()],
      undefined,
      1.0
    );

    expect(summary.geomagneticMultiplier).toBe(1.0);
    expect(summary.combinedMultiplier).toBe(1.0);
    expect(summary.changedRows).toEqual([]);
  });

  it('sets generatedAt to the real replay execution time, not the historical instant being simulated', () => {
    const peakScenario = buildReplayScenarioFromGfzFixture(
      'gfz-may-2024-storm-peak',
      GFZ_HISTORICAL_KP_AP_MAY_2024,
      new Date('2024-05-11T00:00:00.000Z').getTime()
    );

    const realNowMs = new Date('2026-08-25T12:00:00.000Z').getTime();

    const summary = runGeomagneticShadowReplay(
      peakScenario,
      [makeEntry()],
      undefined,
      1.0,
      undefined,
      realNowMs
    );

    expect(summary.generatedAt).toBe('2026-08-25T12:00:00.000Z');
    expect(summary.observedAt).toBe('2024-05-11T00:00:00.000Z');
  });
});
