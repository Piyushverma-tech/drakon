import * as echarts from 'echarts/core';

const CYAN_400 = '#22d3ee';
const CYAN_300 = '#67e8f9';
const GRAY_500 = '#6b7280';
const GRAY_400 = '#9ca3af';
const GRAY_200 = '#e5e7eb';
const RED_400 = '#f87171';
const AMBER_400 = '#fbbf24';
const EMERALD_400 = '#34d399';
const BORDER_SOFT = 'rgba(255, 255, 255, 0.1)';
const BORDER_FAINT = 'rgba(255, 255, 255, 0.05)';

export const DRAKON_ECHARTS_THEME = 'drakon-dark';

let registered = false;

/** Idempotent: safe to call from every chart that imports this module. */
export function registerDrakonEchartsTheme(): void {
  if (registered) return;
  registered = true;

  echarts.registerTheme(DRAKON_ECHARTS_THEME, {
    color: [CYAN_400, EMERALD_400, AMBER_400, RED_400, CYAN_300],
    backgroundColor: 'transparent',
    textStyle: { color: GRAY_400 },
    title: {
      textStyle: { color: GRAY_200 },
      subtextStyle: { color: GRAY_500 },
    },
    line: { lineStyle: { width: 2 } },
    categoryAxis: {
      axisLine: { lineStyle: { color: BORDER_SOFT } },
      axisTick: { lineStyle: { color: BORDER_SOFT } },
      axisLabel: { color: GRAY_500, fontSize: 11 },
      splitLine: { lineStyle: { color: BORDER_FAINT } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: BORDER_SOFT } },
      axisTick: { lineStyle: { color: BORDER_SOFT } },
      axisLabel: { color: GRAY_500, fontSize: 11 },
      splitLine: { lineStyle: { color: BORDER_FAINT } },
    },
    legend: { textStyle: { color: GRAY_400 } },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderColor: BORDER_SOFT,
      borderWidth: 1,
      textStyle: { color: GRAY_200 },
    },
    dataZoom: {
      borderColor: BORDER_SOFT,
      textStyle: { color: GRAY_500 },
      fillerColor: 'rgba(34, 211, 238, 0.1)',
      handleColor: CYAN_400,
      dataBackgroundColor: BORDER_FAINT,
      selectedDataBackgroundColor: 'rgba(34, 211, 238, 0.15)',
    },
    markLine: {
      lineStyle: { color: AMBER_400 },
      label: { color: GRAY_400 },
    },
  });
}
