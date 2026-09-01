/**
 * End-to-end validation of the NOAA parser + Kp -> ap conversion against
 * real, independently-sourced historical data (plan §6.4, §21 Stage 1).
 *
 * This is deliberately a different kind of test from geomagneticIndex.test.ts:
 * that file unit-tests each function against small hand-built fixtures;
 * this file runs the full ingestion pipeline (parseNoaaKpPayload ->
 * reduceToThreeHourApObservations) against 64 real three-hour intervals
 * from the May 2024 "Gannon storm" — see lib/fixtures/gfzHistoricalKpAp.ts
 * for the source and full provenance — and scores the result with real
 * metrics (exact-match rate, mean/max absolute error), not spot checks.
 *
 * IMPORTANT SCOPE NOTE — read this before trusting what this test proves:
 * the "generated" series here is built from synthetic per-minute NOAA-
 * shaped entries whose Kp values are taken FROM the historical reference
 * itself (see buildSyntheticNoaaPayload below), not from a replay of
 * NOAA's actual historical per-minute feed for these dates (that feed
 * isn't archived anywhere this environment can reach). So this test
 * proves: "given NOAA's real response schema and the historically correct
 * Kp value, does DRAKON's parser + Kp->ap table + three-hour reduction
 * reproduce the official published ap record exactly, across 64 real
 * intervals spanning both quiet conditions and the most extreme storm in
 * two decades." It does NOT prove "NOAA's real-time estimated_kp feed
 * agrees with the later-adjudicated definitive record" — that's a
 * genuinely different, real phenomenon (real-time estimates can drift
 * from the adjudicated value), which is exactly why estimatedAp is named
 * the way it is rather than presented as an official value.
 */

import {
  parseNoaaKpPayload,
  reduceToThreeHourApObservations,
  compareApSeries,
  computeApSeriesComparisonMetrics,
  normalizeKpClass,
  type ThreeHourApObservation,
} from './geomagneticIndex';
import {
  GFZ_HISTORICAL_KP_AP_MAY_2024,
  type GfzHistoricalKpApEntry,
} from './fixtures/gfzHistoricalKpAp';
import { GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024 } from './fixtures/gfzHistoricalKpApQuietControl';

/** Reverse of geomagneticIndex.ts's LEGACY_LETTER_SUFFIX, for building realistic synthetic entries. */
const CANONICAL_TO_LEGACY_SUFFIX: Record<string, string> = {
  o: 'Z',
  '+': 'P',
  '-': 'M',
};

function toLegacyKpString(kpClass: string): string {
  const digit = kpClass[0];
  const suffix = CANONICAL_TO_LEGACY_SUFFIX[kpClass.slice(1)];
  return `${digit}${suffix}`;
}

/**
 * Build a NOAA-shaped payload (the confirmed live schema — time_tag,
 * kp_index, estimated_kp, kp) with several per-minute samples per
 * historical interval, all carrying that interval's real historical Kp
 * value. Exercises the real parsing + three-hour reduction logic, not
 * just the lookup table in isolation.
 */
function buildSyntheticNoaaPayload(
  entries: GfzHistoricalKpApEntry[]
): unknown[] {
  const payload: unknown[] = [];

  for (const entry of entries) {
    const kpClass = normalizeKpClass(entry.kpNumeric);
    if (!kpClass) {
      throw new Error(
        `Fixture bug: kpNumeric ${entry.kpNumeric} at ${entry.intervalStart} did not normalize`
      );
    }

    const intervalStartMs = new Date(entry.intervalStart).getTime();
    // Three per-interval samples: near the start, middle, and end of the
    // three-hour window (offsets in minutes) — exercises "latest sample
    // wins" against real interval boundaries, not just a single sample.
    for (const offsetMinutes of [2, 90, 178]) {
      const timeTagMs = intervalStartMs + offsetMinutes * 60_000;
      payload.push({
        time_tag: new Date(timeTagMs).toISOString().replace('Z', ''), // naive, matching the confirmed live schema
        kp_index: Math.round(entry.kpNumeric),
        estimated_kp: entry.kpNumeric,
        kp: toLegacyKpString(kpClass),
      });
    }
  }

  return payload;
}

describe('geomagneticIndex — historical validation against real GFZ/CelesTrak data', () => {
  const generated: ThreeHourApObservation[] = reduceToThreeHourApObservations(
    parseNoaaKpPayload(buildSyntheticNoaaPayload(GFZ_HISTORICAL_KP_AP_MAY_2024))
  );

  const reference = GFZ_HISTORICAL_KP_AP_MAY_2024.map((entry) => ({
    intervalStart: entry.intervalStart,
    ap: entry.officialAp,
  }));

  it('parses and reduces all 64 real historical intervals without dropping any', () => {
    expect(generated).toHaveLength(GFZ_HISTORICAL_KP_AP_MAY_2024.length);
  });

  it('reproduces the official ap record exactly across the full week, including the storm peak', () => {
    const rows = compareApSeries(generated, reference);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.intervalsCompared).toBe(64);
    expect(metrics.intervalsGeneratedOnly).toBe(0);
    expect(metrics.intervalsReferenceOnly).toBe(0);
    expect(metrics.exactMatchRate).toBe(1);
    expect(metrics.meanAbsoluteError).toBe(0);
    expect(metrics.maxAbsoluteError).toBe(0);
    expect(metrics.rootMeanSquareError).toBe(0);
  });

  it('specifically reproduces the storm-peak interval (2024-05-11T00:00Z, Kp 9o, ap 400)', () => {
    const peak = generated.find(
      (o) => o.intervalStart === '2024-05-11T00:00:00.000Z'
    );
    expect(peak?.kpClass).toBe('9o');
    expect(peak?.estimatedAp).toBe(400);
  });

  it('specifically reproduces a quiet interval (2024-05-09T00:00Z, Kp 0.7, ap 3)', () => {
    const quiet = generated.find(
      (o) => o.intervalStart === '2024-05-09T00:00:00.000Z'
    );
    expect(quiet?.kpClass).toBe('1-');
    expect(quiet?.estimatedAp).toBe(3);
  });

  it('detects a real disagreement when the metrics function is fed a deliberately wrong reference', () => {
    // Sanity check on the metrics themselves: this must NOT also come
    // back as a perfect match, or the perfect-match result above would
    // be meaningless (metrics that always say "1.0" regardless of input
    // would trivially pass the real test too).
    const wrongReference = reference.map((row, i) =>
      i === 0 ? { ...row, ap: row.ap + 50 } : row
    );

    const rows = compareApSeries(generated, wrongReference);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.exactMatchRate).toBeCloseTo(63 / 64, 5);
    expect(metrics.maxAbsoluteError).toBe(50);
    expect(metrics.meanAbsoluteError).toBeCloseTo(50 / 64, 5);
  });

  it('reports coverage gaps separately from error when the reference has extra intervals', () => {
    const referenceWithExtra = [
      ...reference,
      { intervalStart: '2024-05-15T00:00:00.000Z', ap: 999 },
    ];

    const rows = compareApSeries(generated, referenceWithExtra);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.intervalsCompared).toBe(64);
    expect(metrics.intervalsReferenceOnly).toBe(1);
    expect(metrics.intervalsGeneratedOnly).toBe(0);
    // The extra reference-only interval must not corrupt the error metrics.
    expect(metrics.meanAbsoluteError).toBe(0);
  });
});

describe('geomagneticIndex — historical validation against a real, independent QUIET CONTROL window', () => {
  // Plan §17 Phase 1 requires "both geomagnetically active and quiet
  // control periods" in the calibration dataset, and Phase 7's
  // quiet-window rejection test specifically needs a genuine control
  // window — not just the quieter days inside the storm week above.
  // See lib/fixtures/gfzHistoricalKpApQuietControl.ts for provenance and
  // why this window (2024-01-04 to 2024-01-17) was chosen.

  const generated: ThreeHourApObservation[] = reduceToThreeHourApObservations(
    parseNoaaKpPayload(
      buildSyntheticNoaaPayload(GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024)
    )
  );

  const reference = GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024.map((entry) => ({
    intervalStart: entry.intervalStart,
    ap: entry.officialAp,
  }));

  it('parses and reduces all 112 real intervals of the quiet control window without dropping any', () => {
    expect(generated).toHaveLength(
      GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024.length
    );
  });

  it('reproduces the official ap record exactly across the full quiet control window', () => {
    const rows = compareApSeries(generated, reference);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.intervalsCompared).toBe(112);
    expect(metrics.intervalsGeneratedOnly).toBe(0);
    expect(metrics.intervalsReferenceOnly).toBe(0);
    expect(metrics.exactMatchRate).toBe(1);
    expect(metrics.meanAbsoluteError).toBe(0);
    expect(metrics.maxAbsoluteError).toBe(0);
  });

  it('confirms the window is genuinely quiet: max real ap stays at 12, nowhere near the storm-peak 400', () => {
    const maxAp = Math.max(...generated.map((o) => o.estimatedAp));
    expect(maxAp).toBe(12);
  });
});
