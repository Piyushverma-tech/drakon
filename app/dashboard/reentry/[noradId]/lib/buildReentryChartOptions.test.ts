import {
  buildAltitudeChartOption,
  buildBstarChartOption,
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
