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

// Spherical approximation of Earth's radius, used to convert perigee/apogee altitudes into orbital radii for eccentricity calculation. This is not the geodetic radius, but it's close enough for the purpose of computing eccentricity from TLE-derived perigee/apogee values.
const EARTH_RADIUS_KM = 6378.137;

/**
 * Eccentricity is the closest available proxy for "how is this orbit's shape
 * changing over time": it's what actually governs how far gamma swings
 * away from zero over a revolution, and it climbs as drag increases
 * orbital asymmetry in the approach to re-entry.
 */
export function buildEccentricityChartOption(
  entries: ObjectHistoryEntry[]
): EvidenceChartOption {
  const points = entries
    .filter((entry) => entry.perigeeKm !== null && entry.apogeeKm !== null)
    .map((entry) => {
      const perigeeRadiusKm = (entry.perigeeKm as number) + EARTH_RADIUS_KM;
      const apogeeRadiusKm = (entry.apogeeKm as number) + EARTH_RADIUS_KM;
      const eccentricity =
        (apogeeRadiusKm - perigeeRadiusKm) / (apogeeRadiusKm + perigeeRadiusKm);
      return [entry.epochMs, eccentricity];
    });

  return {
    grid: BASE_GRID,
    tooltip: BASE_TOOLTIP,
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: 'e' },
    dataZoom: BASE_DATA_ZOOM,
    series: [
      {
        name: 'Eccentricity',
        type: 'line',
        showSymbol: false,
        data: points,
      },
    ],
  };
}
