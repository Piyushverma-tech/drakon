import {
  buildAltitudeChartOption,
  buildBstarChartOption,
  buildEccentricityChartOption,
  ObjectHistoryEntry,
} from './buildReentryChartOptions';

function entry(overrides: Partial<ObjectHistoryEntry>): ObjectHistoryEntry {
  return {
    epochMs: 0,
    bstar: 1e-5,
    meanMotion: 15.5,
    meanMotionDot: 0.00002,
    perigeeKm: 400,
    apogeeKm: 410,
    semiMajorAxisKm: 6780,
    ...overrides,
  };
}

describe('buildAltitudeChartOption', () => {
  it('maps perigee/apogee/sma into separate series keyed by epoch', () => {
    const entries = [
      entry({
        epochMs: 1000,
        perigeeKm: 400,
        apogeeKm: 420,
        semiMajorAxisKm: 6790,
      }),
      entry({
        epochMs: 2000,
        perigeeKm: 395,
        apogeeKm: 418,
        semiMajorAxisKm: 6785,
      }),
    ];

    const option = buildAltitudeChartOption(entries);
    const series = option.series as Array<{ name: string; data: unknown[] }>;

    expect(series).toHaveLength(3);
    expect(series[0].name).toBe('Perigee');
    expect(series[0].data).toEqual([
      [1000, 400],
      [2000, 395],
    ]);
    expect(series[1].data).toEqual([
      [1000, 420],
      [2000, 418],
    ]);
    expect(series[2].data).toEqual([
      [1000, 6790],
      [2000, 6785],
    ]);
  });

  it('omits null values from a series instead of interpolating or zero-filling', () => {
    const entries = [
      entry({ epochMs: 1000, perigeeKm: 400 }),
      entry({ epochMs: 2000, perigeeKm: null }),
      entry({ epochMs: 3000, perigeeKm: 390 }),
    ];

    const option = buildAltitudeChartOption(entries);
    const series = option.series as Array<{ name: string; data: unknown[] }>;

    expect(series[0].data).toEqual([
      [1000, 400],
      [3000, 390],
    ]);
  });
});

describe('buildBstarChartOption', () => {
  it('maps positive bstar values onto the series', () => {
    const entries = [
      entry({ epochMs: 1000, bstar: 1e-6 }),
      entry({ epochMs: 2000, bstar: 5e-5 }),
    ];

    const option = buildBstarChartOption(entries);
    const series = option.series as Array<{ data: unknown[] }>;
    expect(series[0].data).toEqual([
      [1000, 1e-6],
      [2000, 5e-5],
    ]);
  });

  it('drops null and non-positive bstar readings rather than plotting them on a log axis', () => {
    const entries = [
      entry({ epochMs: 1000, bstar: 1e-6 }),
      entry({ epochMs: 2000, bstar: 0 }),
      entry({ epochMs: 3000, bstar: -2e-6 }),
      entry({ epochMs: 4000, bstar: null }),
      entry({ epochMs: 5000, bstar: 3e-5 }),
    ];

    const option = buildBstarChartOption(entries);
    const series = option.series as Array<{ data: unknown[] }>;
    expect(series[0].data).toEqual([
      [1000, 1e-6],
      [5000, 3e-5],
    ]);
  });

  it('uses a log-scale y-axis', () => {
    const option = buildBstarChartOption([
      entry({ epochMs: 1000, bstar: 1e-6 }),
    ]);
    expect((option.yAxis as { type: string }).type).toBe('log');
  });
});

describe('buildEccentricityChartOption', () => {
  it('computes eccentricity from perigee/apogee radii, not raw altitudes', () => {
    // perigee 400km, apogee 400km -> circular -> e = 0
    const circular = entry({ epochMs: 1000, perigeeKm: 400, apogeeKm: 400 });
    const circularOption = buildEccentricityChartOption([circular]);
    const circularSeries = circularOption.series as Array<{
      data: [number, number][];
    }>;
    expect(circularSeries[0].data[0][1]).toBeCloseTo(0, 6);

    // perigee 200km, apogee 40000km -> clearly eccentric, e should be
    // well above 0.5 and below 1.
    const eccentric = entry({
      epochMs: 2000,
      perigeeKm: 200,
      apogeeKm: 40000,
    });
    const eccentricOption = buildEccentricityChartOption([eccentric]);
    const eccentricSeries = eccentricOption.series as Array<{
      data: [number, number][];
    }>;
    expect(eccentricSeries[0].data[0][1]).toBeGreaterThan(0.5);
    expect(eccentricSeries[0].data[0][1]).toBeLessThan(1);
  });

  it('tracks eccentricity increasing over time as an orbit decays toward re-entry', () => {
    // A drag-driven decay typically circularizes perigee against apogee
    // early, then both drop together -- but the widening gap in the
    // approach to re-entry should still read as an upward eccentricity
    // trend here.
    const entries = [
      entry({ epochMs: 1000, perigeeKm: 400, apogeeKm: 410 }),
      entry({ epochMs: 2000, perigeeKm: 250, apogeeKm: 380 }),
      entry({ epochMs: 3000, perigeeKm: 120, apogeeKm: 350 }),
    ];

    const option = buildEccentricityChartOption(entries);
    const series = option.series as Array<{ data: [number, number][] }>;
    const values = series[0].data.map(([, e]) => e);

    expect(values[1]).toBeGreaterThan(values[0]);
    expect(values[2]).toBeGreaterThan(values[1]);
  });

  it('omits entries missing perigee or apogee instead of computing garbage', () => {
    const entries = [
      entry({ epochMs: 1000, perigeeKm: 400, apogeeKm: 410 }),
      entry({ epochMs: 2000, perigeeKm: null, apogeeKm: 410 }),
      entry({ epochMs: 3000, perigeeKm: 400, apogeeKm: null }),
      entry({ epochMs: 4000, perigeeKm: 395, apogeeKm: 405 }),
    ];

    const option = buildEccentricityChartOption(entries);
    const series = option.series as Array<{ data: [number, number][] }>;
    expect(series[0].data.map(([epochMs]) => epochMs)).toEqual([1000, 4000]);
  });
});
