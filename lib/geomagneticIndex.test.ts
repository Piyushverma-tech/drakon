import {
  KP_CLASSES,
  KP_TO_AP_TABLE,
  kpToAp,
  normalizeKpClass,
  threeHourIntervalStart,
  reduceToThreeHourApObservations,
  parseNoaaKpEntry,
  parseNoaaKpPayload,
  compareApSeries,
  computeApSeriesComparisonMetrics,
  computeRecencyWeightedActivity,
  computePersistence,
  classifyStormPhase,
  geomagneticMultiplierFromActivity,
  combineAtmosphericMultipliers,
  mergeApHistory,
  buildReplayGeomagneticState,
  GEOMAG_ACTIVITY_THRESHOLD,
  GEOMAG_SCALE,
  GEOMAG_POWER,
  GEOMAG_AMPLITUDE,
  MAX_GEOMAG_MULTIPLIER,
  GEOMAG_HISTORY_HOURS,
  type NoaaKpSample,
  type ThreeHourApObservation,
} from './geomagneticIndex';

describe('geomagneticIndex — Kp class normalization', () => {
  it('accepts canonical "+", "o", "-" string forms', () => {
    expect(normalizeKpClass('4+')).toBe('4+');
    expect(normalizeKpClass('4o')).toBe('4o');
    expect(normalizeKpClass('4-')).toBe('4-');
    expect(normalizeKpClass('4O')).toBe('4o');
  });

  it('accepts the legacy Z/P/M letter-suffix convention', () => {
    expect(normalizeKpClass('3Z')).toBe('3o');
    expect(normalizeKpClass('3P')).toBe('3+');
    expect(normalizeKpClass('3M')).toBe('3-');
    expect(normalizeKpClass('3z')).toBe('3o');
  });

  it('accepts the one-third-step numeric convention', () => {
    expect(normalizeKpClass(0)).toBe('0o');
    expect(normalizeKpClass(0.33)).toBe('0+');
    expect(normalizeKpClass(0.67)).toBe('1-');
    expect(normalizeKpClass(4)).toBe('4o');
    expect(normalizeKpClass(4.33)).toBe('4+');
    expect(normalizeKpClass(4.67)).toBe('5-');
    expect(normalizeKpClass(9)).toBe('9o');
  });

  it('accepts a numeric string', () => {
    expect(normalizeKpClass('4.33')).toBe('4+');
  });

  it('rejects out-of-scale, malformed, and off-grid values rather than approximating', () => {
    expect(normalizeKpClass('9+')).toBeNull(); // not a published class
    expect(normalizeKpClass('0-')).toBeNull(); // not a published class
    expect(normalizeKpClass(9.33)).toBeNull(); // above the top of the scale
    expect(normalizeKpClass(-1)).toBeNull();
    expect(normalizeKpClass(10)).toBeNull();
    expect(normalizeKpClass('not-a-kp-value')).toBeNull();
    expect(normalizeKpClass(null)).toBeNull();
    expect(normalizeKpClass(undefined)).toBeNull();
    expect(normalizeKpClass('')).toBeNull();
  });

  it('does not silently round an ambiguous numeric value to the nearest integer', () => {
    // 4.5 is roughly equidistant between 4+ (4.33) and 5- (4.67) and well
    // outside the matching tolerance for either — must reject, not guess.
    expect(normalizeKpClass(4.5)).toBeNull();
  });
});

describe('geomagneticIndex — Kp -> ap lookup', () => {
  it('has exactly 28 published classes', () => {
    expect(KP_CLASSES.length).toBe(28);
    expect(Object.keys(KP_TO_AP_TABLE).length).toBe(28);
  });

  it('matches the published Bartels/IAGA table for all 28 classes', () => {
    const expected: Record<string, number> = {
      '0o': 0, '0+': 2,
      '1-': 3, '1o': 4, '1+': 5,
      '2-': 6, '2o': 7, '2+': 9,
      '3-': 12, '3o': 15, '3+': 18,
      '4-': 22, '4o': 27, '4+': 32,
      '5-': 39, '5o': 48, '5+': 56,
      '6-': 67, '6o': 80, '6+': 94,
      '7-': 111, '7o': 132, '7+': 154,
      '8-': 179, '8o': 207, '8+': 236,
      '9-': 300, '9o': 400,
    };

    for (const [kpClass, ap] of Object.entries(expected)) {
      expect(kpToAp(kpClass)).toBe(ap);
      expect(KP_TO_AP_TABLE[kpClass as keyof typeof KP_TO_AP_TABLE]).toBe(ap);
    }
  });

  it('is monotonically non-decreasing across the canonical class sequence', () => {
    for (let i = 1; i < KP_CLASSES.length; i++) {
      expect(KP_TO_AP_TABLE[KP_CLASSES[i]]).toBeGreaterThan(
        KP_TO_AP_TABLE[KP_CLASSES[i - 1]]
      );
    }
  });

  it('accepts numeric one-third-step input directly', () => {
    expect(kpToAp(4.33)).toBe(32);
  });

  it('throws rather than approximating an unrecognized Kp value', () => {
    expect(() => kpToAp('9+')).toThrow();
    expect(() => kpToAp(11)).toThrow();
    expect(() => kpToAp('garbage')).toThrow();
  });
});

describe('geomagneticIndex — three-hour interval semantics', () => {
  it('floors a timestamp to the start of its three-hour UTC interval', () => {
    expect(threeHourIntervalStart('2026-06-01T09:47:00Z')).toBe(
      '2026-06-01T09:00:00.000Z'
    );
    expect(threeHourIntervalStart('2026-06-01T00:00:00Z')).toBe(
      '2026-06-01T00:00:00.000Z'
    );
    expect(threeHourIntervalStart('2026-06-01T23:59:00Z')).toBe(
      '2026-06-01T21:00:00.000Z'
    );
  });

  it('rejects an invalid timestamp', () => {
    expect(() => threeHourIntervalStart('not-a-date')).toThrow();
  });

  function sample(observedAt: string, kpClass: NoaaKpSample['kpClass']): NoaaKpSample {
    return { observedAt, kpClass, estimatedAp: KP_TO_AP_TABLE[kpClass] };
  }

  it('reduces repeated per-minute samples in the same interval to one observation', () => {
    const samples: NoaaKpSample[] = [
      sample('2026-06-01T09:03:00.000Z', '4o'),
      sample('2026-06-01T09:15:00.000Z', '4+'),
      sample('2026-06-01T09:58:00.000Z', '5-'),
    ];

    const observations = reduceToThreeHourApObservations(samples);

    expect(observations).toHaveLength(1);
    expect(observations[0].intervalStart).toBe('2026-06-01T09:00:00.000Z');
    // Prefers the latest valid sample for the interval, not an average.
    expect(observations[0].kpClass).toBe('5-');
    expect(observations[0].estimatedAp).toBe(39);
  });

  it('produces one observation per distinct three-hour interval, sorted ascending', () => {
    const samples: NoaaKpSample[] = [
      sample('2026-06-01T09:03:00.000Z', '3o'),
      sample('2026-06-01T00:10:00.000Z', '1-'),
      sample('2026-06-01T12:59:00.000Z', '6+'),
    ];

    const observations = reduceToThreeHourApObservations(samples);

    expect(observations.map((o) => o.intervalStart)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T09:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
    ]);
  });

  it('drops samples with an unparsable timestamp instead of throwing', () => {
    const samples: NoaaKpSample[] = [
      sample('not-a-timestamp', '3o'),
      sample('2026-06-01T09:03:00.000Z', '4o'),
    ];

    const observations = reduceToThreeHourApObservations(samples);
    expect(observations).toHaveLength(1);
    expect(observations[0].kpClass).toBe('4o');
  });
});

describe('geomagneticIndex — NOAA payload parsing', () => {
  // Confirmed live shape (sampled 2026-08-23):
  // { "time_tag": "2026-08-23T12:59:00", "kp_index": 1, "estimated_kp": 0.67, "kp": "1M" }

  it('parses a well-formed live-shaped entry, preferring kp/estimated_kp', () => {
    const sample = parseNoaaKpEntry({
      time_tag: '2026-08-23T12:59:00',
      kp_index: 1,
      estimated_kp: 0.67,
      kp: '1M',
    });

    expect(sample).not.toBeNull();
    expect(sample?.kpClass).toBe('1-');
    expect(sample?.estimatedAp).toBe(3);
  });

  it('treats the naive (zone-less) time_tag as UTC, not local time', () => {
    const sample = parseNoaaKpEntry({
      time_tag: '2026-08-23T12:59:00',
      estimated_kp: 0.67,
      kp: '1M',
    });

    expect(sample?.observedAt).toBe('2026-08-23T12:59:00.000Z');
  });

  it('ignores kp_index as a value source (it is a lossy rounded integer)', () => {
    // kp_index=1 would normalize to "1o" if used directly; the true
    // subdivided class from kp/estimated_kp is "1-". kp_index must not win.
    const sample = parseNoaaKpEntry({
      time_tag: '2026-08-23T12:59:00',
      kp_index: 1,
      estimated_kp: 0.67,
      kp: '1M',
    });

    expect(sample?.kpClass).toBe('1-');
    expect(sample?.kpClass).not.toBe('1o');
  });

  it('falls back to whichever of kp / estimated_kp is present alone', () => {
    expect(
      parseNoaaKpEntry({ time_tag: '2026-06-01T09:03:00Z', estimated_kp: 3 })
        ?.kpClass
    ).toBe('3o');
    expect(
      parseNoaaKpEntry({ time_tag: '2026-06-01T09:03:00Z', kp: '5-' })?.kpClass
    ).toBe('5-');
  });

  it('rejects an entry where kp and estimated_kp disagree, rather than guessing', () => {
    const sample = parseNoaaKpEntry({
      time_tag: '2026-08-23T12:59:00',
      kp: '1M', // 1-
      estimated_kp: 4.33, // 4+
    });

    expect(sample).toBeNull();
  });

  it('rejects an entry with a missing timestamp or Kp field', () => {
    expect(parseNoaaKpEntry({ kp: '4+' })).toBeNull();
    expect(parseNoaaKpEntry({ time_tag: '2026-06-01T09:03:00Z' })).toBeNull();
  });

  it('rejects an entry with an unparsable timestamp', () => {
    expect(parseNoaaKpEntry({ time_tag: 'not-a-date', kp: '4+' })).toBeNull();
  });

  it('rejects an entry with an unrecognized Kp value without throwing', () => {
    expect(
      parseNoaaKpEntry({ time_tag: '2026-06-01T09:03:00Z', kp: '99' })
    ).toBeNull();
  });

  it('rejects non-object entries', () => {
    expect(parseNoaaKpEntry(null)).toBeNull();
    expect(parseNoaaKpEntry('4.33')).toBeNull();
    expect(parseNoaaKpEntry(42)).toBeNull();
  });

  it('parses a full payload, dropping bad rows without failing the batch', () => {
    const samples = parseNoaaKpPayload([
      { time_tag: '2026-06-01T09:03:00Z', kp: '3o' },
      { time_tag: 'garbage', kp: '3o' },
      { time_tag: '2026-06-01T09:04:00Z', kp: 'not-a-kp' },
      { time_tag: '2026-06-01T09:05:00Z', kp: '4+' },
    ]);

    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.kpClass)).toEqual(['3o', '4+']);
  });

  it('returns an empty array for a malformed (non-array) payload', () => {
    expect(parseNoaaKpPayload(null)).toEqual([]);
    expect(parseNoaaKpPayload({ not: 'an array' })).toEqual([]);
    expect(parseNoaaKpPayload('garbage')).toEqual([]);
  });
});

describe('geomagneticIndex — reference-series comparison (dev/validation utility)', () => {
  it('flags matching and diverging intervals against an independent series', () => {
    const generated = reduceToThreeHourApObservations([
      { observedAt: '2026-06-01T09:03:00.000Z', kpClass: '4o' as const, estimatedAp: 27 },
      { observedAt: '2026-06-01T12:03:00.000Z', kpClass: '5-' as const, estimatedAp: 39 },
    ]);

    const reference = [
      { intervalStart: '2026-06-01T09:00:00.000Z', ap: 27 },
      { intervalStart: '2026-06-01T12:00:00.000Z', ap: 32 },
      { intervalStart: '2026-06-01T15:00:00.000Z', ap: 18 },
    ];

    const result = compareApSeries(generated, reference);

    const nine = result.find((r) => r.intervalStart === '2026-06-01T09:00:00.000Z');
    const twelve = result.find((r) => r.intervalStart === '2026-06-01T12:00:00.000Z');
    const fifteen = result.find((r) => r.intervalStart === '2026-06-01T15:00:00.000Z');

    expect(nine?.matches).toBe(true);
    expect(twelve?.matches).toBe(false);
    expect(twelve?.delta).toBe(7);
    expect(fifteen?.generatedAp).toBeNull();
    expect(fifteen?.referenceAp).toBe(18);
  });

  it('computeApSeriesComparisonMetrics summarizes matches, coverage gaps, and error stats', () => {
    const generated = reduceToThreeHourApObservations([
      { observedAt: '2026-06-01T09:03:00.000Z', kpClass: '4o' as const, estimatedAp: 27 },
      { observedAt: '2026-06-01T12:03:00.000Z', kpClass: '5-' as const, estimatedAp: 39 },
      { observedAt: '2026-06-01T18:03:00.000Z', kpClass: '3o' as const, estimatedAp: 15 },
    ]);

    const reference = [
      { intervalStart: '2026-06-01T09:00:00.000Z', ap: 27 }, // exact match
      { intervalStart: '2026-06-01T12:00:00.000Z', ap: 32 }, // mismatch, |delta|=7
      { intervalStart: '2026-06-01T15:00:00.000Z', ap: 18 }, // reference-only
      // 18:00 interval: generated-only (no reference row)
    ];

    const rows = compareApSeries(generated, reference);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.intervalsCompared).toBe(2);
    expect(metrics.intervalsGeneratedOnly).toBe(1);
    expect(metrics.intervalsReferenceOnly).toBe(1);
    expect(metrics.exactMatches).toBe(1);
    expect(metrics.exactMatchRate).toBeCloseTo(0.5, 5);
    expect(metrics.meanAbsoluteError).toBeCloseTo(3.5, 5); // (0 + 7) / 2
    expect(metrics.maxAbsoluteError).toBe(7);
    expect(metrics.rootMeanSquareError).toBeCloseTo(Math.sqrt((0 + 49) / 2), 5);
  });

  it('computeApSeriesComparisonMetrics returns null error stats (not zero) when nothing overlaps', () => {
    const rows = compareApSeries([], [{ intervalStart: '2026-06-01T09:00:00.000Z', ap: 27 }]);
    const metrics = computeApSeriesComparisonMetrics(rows);

    expect(metrics.intervalsCompared).toBe(0);
    expect(metrics.intervalsReferenceOnly).toBe(1);
    expect(metrics.exactMatchRate).toBe(0);
    expect(metrics.meanAbsoluteError).toBeNull();
    expect(metrics.maxAbsoluteError).toBeNull();
    expect(metrics.rootMeanSquareError).toBeNull();
  });
});

describe('geomagneticIndex — buildReplayGeomagneticState', () => {
  it('returns the default state for an empty history', () => {
    const state = buildReplayGeomagneticState([], Date.now());
    expect(state.freshness).toBe('default');
    expect(state.multiplier).toBe(1.0);
    expect(state.kpClass).toBeNull();
  });

  it('picks the latest eligible observation at or before asOfMs, ignoring later ones', () => {
    const history: ThreeHourApObservation[] = [
      obs('2026-06-01T00:00:00.000Z', 15),
      obs('2026-06-01T09:00:00.000Z', 80), // this is the replay point
      obs('2026-06-01T18:00:00.000Z', 400), // in the "future" relative to asOfMs
    ];
    const asOfMs = new Date('2026-06-01T10:00:00.000Z').getTime();

    const state = buildReplayGeomagneticState(history, asOfMs);

    expect(state.estimatedAp).toBe(80);
    expect(state.observedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(state.freshness).toBe('live');
  });

  it('does not leak future observations into the activity weighting (no look-ahead bias)', () => {
    const history: ThreeHourApObservation[] = [
      obs('2026-06-01T09:00:00.000Z', 15),
      obs('2026-06-01T18:00:00.000Z', 400), // far in the "future" relative to asOfMs
    ];
    const asOfMs = new Date('2026-06-01T10:00:00.000Z').getTime();

    const withFuture = buildReplayGeomagneticState(history, asOfMs);
    const withoutFuture = buildReplayGeomagneticState([history[0]], asOfMs);

    // The activity computed with the extra future-dated sample present in
    // the input array must be identical to the activity computed without
    // it ever having existed — proving it was excluded, not just
    // down-weighted by age.
    expect(withFuture.activity).toBe(withoutFuture.activity);
    expect(withFuture.history).toHaveLength(1);
  });

  it('returns the default state when every observation is after asOfMs', () => {
    const history: ThreeHourApObservation[] = [obs('2026-06-01T18:00:00.000Z', 80)];
    const asOfMs = new Date('2026-06-01T00:00:00.000Z').getTime();

    const state = buildReplayGeomagneticState(history, asOfMs);
    expect(state.freshness).toBe('default');
  });
});

function obs(intervalStart: string, ap: number): ThreeHourApObservation {
  const kpClass = KP_CLASSES.find((c) => KP_TO_AP_TABLE[c] === ap) ?? '4o';
  return { intervalStart, kpClass, estimatedAp: ap, observedAt: intervalStart };
}

describe('geomagneticIndex — mergeApHistory', () => {
  const now = new Date('2026-06-02T00:00:00.000Z').getTime();

  it('lets incoming samples win on a same-interval conflict', () => {
    const existing = [obs('2026-06-01T09:00:00.000Z', 27)];
    const incoming = [obs('2026-06-01T09:00:00.000Z', 39)];

    const merged = mergeApHistory(existing, incoming, now);

    expect(merged).toHaveLength(1);
    expect(merged[0].estimatedAp).toBe(39);
  });

  it('merges distinct intervals and sorts ascending', () => {
    const existing = [obs('2026-06-01T12:00:00.000Z', 15)];
    const incoming = [obs('2026-06-01T09:00:00.000Z', 27)];

    const merged = mergeApHistory(existing, incoming, now);

    expect(merged.map((o) => o.intervalStart)).toEqual([
      '2026-06-01T09:00:00.000Z',
      '2026-06-01T12:00:00.000Z',
    ]);
  });

  it('trims entries older than GEOMAG_HISTORY_HOURS', () => {
    const tooOld = new Date(now - (GEOMAG_HISTORY_HOURS + 3) * 3_600_000).toISOString();
    const withinWindow = new Date(now - 3 * 3_600_000).toISOString();

    const merged = mergeApHistory([obs(tooOld, 4)], [obs(withinWindow, 27)], now);

    expect(merged).toHaveLength(1);
    expect(merged[0].intervalStart).toBe(withinWindow);
  });
});

describe('geomagneticIndex — computeRecencyWeightedActivity', () => {
  const now = new Date('2026-06-01T12:00:00.000Z').getTime();

  it('returns null for empty history', () => {
    expect(computeRecencyWeightedActivity([], now)).toBeNull();
  });

  it('returns approximately the single sample value when only one exists', () => {
    const activity = computeRecencyWeightedActivity(
      [obs('2026-06-01T12:00:00.000Z', 27)],
      now
    );
    expect(activity).toBeCloseTo(27, 5);
  });

  it('weights recent samples more heavily than older ones', () => {
    const history = [
      obs('2026-05-30T12:00:00.000Z', 300), // 2 days old — heavily discounted
      obs('2026-06-01T09:00:00.000Z', 27), // 3 hours old — dominant
    ];

    const activity = computeRecencyWeightedActivity(history, now, 12);

    // Should sit much closer to the recent sample than a plain average
    // ((300+27)/2 = 163.5) would suggest.
    expect(activity).not.toBeNull();
    expect(activity as number).toBeLessThan(60);
    expect(activity as number).toBeGreaterThan(27);
  });

  it('ignores future-dated samples rather than letting them skew the result', () => {
    const history = [
      obs('2026-06-01T12:00:00.000Z', 27),
      obs('2026-06-05T00:00:00.000Z', 400), // in the future relative to `now`
    ];
    const activity = computeRecencyWeightedActivity(history, now);
    expect(activity).toBeCloseTo(27, 5);
  });

  it('weights by observedAt, not intervalStart — a sample observed late in its bucket is fresher than the bucket boundary implies', () => {
    // Same two observations either way; only observedAt differs from
    // intervalStart. A (high ap) was actually observed most of the way
    // through its interval, so its true age is much less than
    // intervalStart would suggest — it should pull the weighted average
    // up, not down.
    const history: ThreeHourApObservation[] = [
      {
        intervalStart: '2026-06-01T00:00:00.000Z',
        observedAt: '2026-06-01T02:58:00.000Z',
        kpClass: '9o',
        estimatedAp: 300,
      },
      {
        intervalStart: '2026-06-01T09:00:00.000Z',
        observedAt: '2026-06-01T09:02:00.000Z',
        kpClass: '1o',
        estimatedAp: 4,
      },
    ];

    const now2 = new Date('2026-06-01T09:03:00.000Z').getTime();
    const activity = computeRecencyWeightedActivity(history, now2, 12);

    // Verified by direct computation: weighting by observedAt gives
    // ~115.4; the old (incorrect) intervalStart-based weighting would
    // have given ~99.0 for the same inputs.
    expect(activity).toBeCloseTo(115.37, 1);
  });
});

describe('geomagneticIndex — computePersistence', () => {
  const now = new Date('2026-06-01T12:00:00.000Z').getTime();

  it('returns null for empty history', () => {
    expect(computePersistence([], now)).toBeNull();
  });

  it('computes the fraction of intervals above the quiet threshold', () => {
    const history = [
      obs('2026-06-01T03:00:00.000Z', 4), // quiet
      obs('2026-06-01T06:00:00.000Z', 27), // active
      obs('2026-06-01T09:00:00.000Z', 39), // active
      obs('2026-06-01T12:00:00.000Z', 4), // quiet
    ];
    expect(computePersistence(history, now)).toBeCloseTo(0.5, 5);
  });

  it('windows by observedAt, not intervalStart — a sample observed late in its bucket can fall inside the window even when its intervalStart does not', () => {
    // windowHours=5 from now(12:00) -> cutoff at 07:00. This sample's
    // intervalStart (06:00) is before the cutoff, but it was actually
    // observed at 08:58 — inside the window. It must be counted.
    const lateInBucket: ThreeHourApObservation = {
      intervalStart: '2026-06-01T06:00:00.000Z',
      observedAt: '2026-06-01T08:58:00.000Z',
      kpClass: '6o',
      estimatedAp: 80,
    };

    const persistence = computePersistence(
      [lateInBucket],
      now,
      GEOMAG_ACTIVITY_THRESHOLD,
      5
    );

    // Old (incorrect) intervalStart-based windowing would have excluded
    // this sample entirely and returned null.
    expect(persistence).toBe(1);
  });
});

describe('geomagneticIndex — classifyStormPhase', () => {
  const now = new Date('2026-06-01T12:00:00.000Z').getTime();

  it('classifies empty or all-quiet history as quiet', () => {
    expect(classifyStormPhase([], now)).toBe('quiet');
    expect(
      classifyStormPhase(
        [obs('2026-06-01T09:00:00.000Z', 4), obs('2026-06-01T12:00:00.000Z', 6)],
        now
      )
    ).toBe('quiet');
  });

  it('classifies a climbing recent sequence as rising', () => {
    const history = [
      obs('2026-06-01T03:00:00.000Z', 15),
      obs('2026-06-01T06:00:00.000Z', 27),
      obs('2026-06-01T09:00:00.000Z', 48),
      obs('2026-06-01T12:00:00.000Z', 94),
    ];
    expect(classifyStormPhase(history, now)).toBe('rising');
  });

  it('classifies a sustained high plateau as sustained', () => {
    const history = [
      obs('2026-06-01T03:00:00.000Z', 80),
      obs('2026-06-01T06:00:00.000Z', 80),
      obs('2026-06-01T09:00:00.000Z', 80),
      obs('2026-06-01T12:00:00.000Z', 80),
    ];
    expect(classifyStormPhase(history, now)).toBe('sustained');
  });

  it('classifies a falling recent sequence as recovering', () => {
    const history = [
      obs('2026-06-01T03:00:00.000Z', 94),
      obs('2026-06-01T06:00:00.000Z', 48),
      obs('2026-06-01T09:00:00.000Z', 27),
      obs('2026-06-01T12:00:00.000Z', 15),
    ];
    expect(classifyStormPhase(history, now)).toBe('recovering');
  });
});

describe('geomagneticIndex — geomagneticMultiplierFromActivity', () => {
  it('is exactly 1.0 for null, non-finite, or below-threshold activity', () => {
    expect(geomagneticMultiplierFromActivity(null)).toBe(1.0);
    expect(geomagneticMultiplierFromActivity(NaN)).toBe(1.0);
    expect(geomagneticMultiplierFromActivity(Number.POSITIVE_INFINITY)).toBe(1.0);
    expect(geomagneticMultiplierFromActivity(GEOMAG_ACTIVITY_THRESHOLD)).toBe(1.0);
    expect(geomagneticMultiplierFromActivity(3)).toBe(1.0);
  });

  it('matches the published power-law formula above the threshold', () => {
    // x = (activity - threshold) / scale = 0.25 -> well under the clamp ceiling
    const activity = GEOMAG_ACTIVITY_THRESHOLD + GEOMAG_SCALE * 0.25;
    const expected = 1 + GEOMAG_AMPLITUDE * Math.pow(0.25, GEOMAG_POWER);
    expect(expected).toBeLessThan(MAX_GEOMAG_MULTIPLIER); // sanity: this case shouldn't clamp
    expect(geomagneticMultiplierFromActivity(activity)).toBeCloseTo(expected, 5);
  });

  it('never exceeds MAX_GEOMAG_MULTIPLIER even for extreme activity', () => {
    expect(geomagneticMultiplierFromActivity(100000)).toBe(MAX_GEOMAG_MULTIPLIER);
  });

  it('is monotonically non-decreasing in activity', () => {
    const values = [0, 5, 9, 20, 50, 100, 300, 1000].map((a) =>
      geomagneticMultiplierFromActivity(a)
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe('geomagneticIndex — combineAtmosphericMultipliers', () => {
  it('multiplies solar and geomagnetic multipliers together', () => {
    expect(combineAtmosphericMultipliers(1.2, 1.25)).toBeCloseTo(1.5, 5);
  });

  it('reduces to solar-only when the geomagnetic multiplier is exactly quiet (1.0)', () => {
    expect(combineAtmosphericMultipliers(1.2, 1.0)).toBe(1.2);
  });

  it('degrades to solar-only rather than propagating an invalid geomagnetic multiplier', () => {
    expect(combineAtmosphericMultipliers(1.2, NaN)).toBe(1.2);
    expect(combineAtmosphericMultipliers(1.2, 0.5)).toBe(1.2); // < 1.0 is invalid
  });

  it('falls back to a valid geomagnetic multiplier if solar is invalid', () => {
    expect(combineAtmosphericMultipliers(NaN, 1.3)).toBe(1.3);
    expect(combineAtmosphericMultipliers(0, 1.3)).toBe(1.3);
  });

  it('never throws or returns non-finite output for double-invalid input', () => {
    expect(combineAtmosphericMultipliers(NaN, NaN)).toBe(1.0);
  });
});
