import type { ComposeOption } from 'echarts/core';
import type { LineSeriesOption } from 'echarts/charts';
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  DataZoomComponentOption,
} from 'echarts/components';

/** Mirrors one row returned by /api/object-trends/[noradId]/history. */
export interface ObjectHistoryEntry {
  epochMs: number;
  bstar: number | null;
  meanMotion: number | null;
  meanMotionDot: number | null;
  perigeeKm: number | null;
  apogeeKm: number | null;
  semiMajorAxisKm: number | null;
}

type EvidenceChartOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
>;

const BASE_GRID: GridComponentOption = {
  left: 48,
  right: 16,
  top: 32,
  bottom: 48,
};

const BASE_TOOLTIP: TooltipComponentOption = {
  trigger: 'axis',
};

const BASE_DATA_ZOOM: DataZoomComponentOption[] = [
  { type: 'inside', xAxisIndex: 0 },
  { type: 'slider', xAxisIndex: 0, height: 16, bottom: 8 },
];

export function buildAltitudeChartOption(
  entries: ObjectHistoryEntry[]
): EvidenceChartOption {
  const toPoints = (key: 'perigeeKm' | 'apogeeKm' | 'semiMajorAxisKm') =>
    entries
      .filter((entry) => entry[key] !== null)
      .map((entry) => [entry.epochMs, entry[key] as number]);

  return {
    grid: BASE_GRID,
    tooltip: BASE_TOOLTIP,
    legend: { data: ['Perigee', 'Apogee', 'Semi-major axis'], top: 0 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: 'km' },
    dataZoom: BASE_DATA_ZOOM,
    series: [
      {
        name: 'Perigee',
        type: 'line',
        showSymbol: false,
        data: toPoints('perigeeKm'),
      },
      {
        name: 'Apogee',
        type: 'line',
        showSymbol: false,
        data: toPoints('apogeeKm'),
      },
      {
        name: 'Semi-major axis',
        type: 'line',
        showSymbol: false,
        data: toPoints('semiMajorAxisKm'),
      },
    ],
  };
}

export function buildBstarChartOption(
  entries: ObjectHistoryEntry[]
): EvidenceChartOption {
  const points = entries
    .filter((entry) => entry.bstar !== null && entry.bstar > 0)
    .map((entry) => [entry.epochMs, entry.bstar as number]);

  return {
    grid: BASE_GRID,
    tooltip: BASE_TOOLTIP,
    xAxis: { type: 'time' },
    yAxis: { type: 'log', name: '1/er' },
    dataZoom: BASE_DATA_ZOOM,
    series: [
      {
        name: 'Bstar',
        type: 'line',
        showSymbol: false,
        data: points,
      },
    ],
  };
}

/**
 * Orbital period (1440 / meanMotion) in minutes. 1440 = minutes/day, meanMotion = rev/day.
 */
export function buildPeriodChartOption(
  entries: ObjectHistoryEntry[]
): EvidenceChartOption {
  const points = entries
    .filter((entry) => entry.meanMotion !== null && entry.meanMotion > 0)
    .map((entry) => [entry.epochMs, 1440 / (entry.meanMotion as number)]);

  return {
    grid: BASE_GRID,
    tooltip: BASE_TOOLTIP,
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: 'min' },
    dataZoom: BASE_DATA_ZOOM,
    series: [
      {
        name: 'Period',
        type: 'line',
        showSymbol: false,
        data: points,
      },
    ],
  };
}
