'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import type {
  GridComponentOption,
  DataZoomComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  DRAKON_ECHARTS_THEME,
  registerDrakonEchartsTheme,
} from './Drakontheme';

echarts.use([
  LineChart,
  GridComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
registerDrakonEchartsTheme();

export interface EChartProps {
  /** ECharts option object. */
  option: echarts.ComposeOption<
    | LineSeriesOption
    | GridComponentOption
    | DataZoomComponentOption
    | TooltipComponentOption
    | LegendComponentOption
  >;
  height?: number | string;
  width?: number | string;
  className?: string;
  /** Shows ECharts' built-in loading spinner, themed to match the palette. */
  loading?: boolean;
}

export function EChart({
  option,
  height = 320,
  width = '100%',
  className,
  loading = false,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = echarts.init(containerRef.current, DRAKON_ECHARTS_THEME, {
      renderer: 'canvas',
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (loading) {
      chart.showLoading('default', {
        text: '',
        color: '#22d3ee',
        textColor: '#9ca3af',
        maskColor: 'rgba(0, 0, 0, 0.4)',
        zlevel: 0,
      });
    } else {
      chart.hideLoading();
    }
  }, [loading]);

  return (
    <div ref={containerRef} className={className} style={{ height, width }} />
  );
}
