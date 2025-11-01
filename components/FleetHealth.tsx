'use client';

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { useTle } from '@/lib/tle-context';
import {
  assessSatelliteHealth,
  aggregateFleetHealth,
  generateMockTelemetry,
  type SatelliteHealth,
  type FleetHealthSummary,
} from '@/lib/fleet-health';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';

// ----------------------
// Donut Chart Component using Recharts
// ----------------------
type DonutChartProps = {
  healthy: number;
  warning: number;
  critical: number;
  total: number;
};

function HealthDonutChart({ healthy, warning, critical, total }: DonutChartProps) {
  const data = [
    { name: 'Healthy', value: healthy, color: '#22c55e' },
    { name: 'Warning', value: warning, color: '#eab308' },
    { name: 'Critical', value: critical, color: '#ef4444' },
  ].filter((item) => item.value > 0);

  const healthPercent = total > 0 ? Math.round((healthy / total) * 100) : 0;

  // If no data, show empty state
  if (data.length === 0 || total === 0) {
    return (
      <div className="relative flex items-center justify-center h-[140px]">
        <div className="text-center">
          <span className="text-2xl font-bold text-white">0%</span>
          <span className="block text-xs text-gray-400">No Data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height: '140px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={60}
            paddingAngle={2}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-bold text-white">{healthPercent}%</span>
        <span className="text-xs text-gray-400">Healthy</span>
      </div>
    </div>
  );
}

// ----------------------
// Trendline Component using Recharts
// ----------------------
type TrendlineProps = {
  data: Array<{ timestamp: number; value: number }>; // Array of health data with timestamps
  maxPoints?: number;
};

function HealthTrendline({ data, maxPoints = 20 }: TrendlineProps) {
  const displayData = data.slice(-maxPoints).map((entry) => ({
    timestamp: entry.timestamp,
    time: new Date(entry.timestamp).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    }),
    health: Math.round(entry.value),
  }));

  if (displayData.length === 0) {
    return (
      <div className="h-16 flex items-center justify-center text-gray-500 text-xs">
        Collecting data...
      </div>
    );
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <XAxis 
            dataKey="time" 
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={30}
          />
          <YAxis 
            domain={[0, 100]}
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickFormatter={(value) => `${value}%`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(17, 24, 39)',
              border: '1px solid rgb(55, 65, 81)',
              borderRadius: '6px',
              color: '#fff',
            }}
            labelFormatter={(label) => `Time: ${label}`}
            formatter={(value: number) => [`${value}%`, 'Health']}
          />
          <Line
            type="monotone"
            dataKey="health"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ----------------------
// Main Component
// ----------------------
export default function FleetHealth() {
  const { tleRef } = useTle();
  const [healthStatuses, setHealthStatuses] = useState<SatelliteHealth[]>([]);
  const [healthHistory, setHealthHistory] = useState<Array<{ timestamp: number; value: number }>>([]);

  // Update health statuses when TLE data changes
  const updateHealth = useCallback(() => {
    if (!tleRef.current || tleRef.current.length === 0) {
      setHealthStatuses([]);
      return;
    }

    const statuses = tleRef.current.map((meta) => {
      const telemetry = generateMockTelemetry(meta, true);
      return assessSatelliteHealth(meta, telemetry);
    });

    setHealthStatuses(statuses);
  }, [tleRef]);

  // Initialize and update periodically
  useEffect(() => {
    updateHealth();
    const interval = setInterval(updateHealth, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [updateHealth]);

  // Update health history when summary changes
  useEffect(() => {
    if (healthStatuses.length > 0) {
      const summary = aggregateFleetHealth(healthStatuses);
      const now = Date.now();
      setHealthHistory((prev) => {
        const newHistory = [...prev, { timestamp: now, value: summary.healthPercent }];
        // Keep last 50 points
        return newHistory.slice(-50);
      });
    }
  }, [healthStatuses]);

  // Compute summary
  const summary = useMemo(() => {
    if (healthStatuses.length === 0) {
      return {
        total: 0,
        healthy: 0,
        warning: 0,
        critical: 0,
        healthPercent: 0,
      };
    }
    return aggregateFleetHealth(healthStatuses);
  }, [healthStatuses]);

  return (
    <div className="space-y-4">
      {/* Donut Chart */}
      <div className="flex items-center justify-center w-full">
        <div className="w-full max-w-[200px]">
          <HealthDonutChart
            healthy={summary.healthy}
            warning={summary.warning}
            critical={summary.critical}
            total={summary.total}
          />
        </div>
      </div>

      {/* Health Statistics */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold text-green-500">
            {summary.healthy}
          </div>
          <div className="text-xs text-gray-400">Healthy</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-yellow-500">
            {summary.warning}
          </div>
          <div className="text-xs text-gray-400">Warning</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-red-500">
            {summary.critical}
          </div>
          <div className="text-xs text-gray-400">Critical</div>
        </div>
      </div>

      {/* Trendline */}
      <div className="border-t border-gray-700 pt-3">
        <div className="text-xs text-gray-400 mb-2">Fleet Health Trend</div>
        <HealthTrendline data={healthHistory} />
      </div>

      {/* Total count */}
      <div className="text-center text-xs text-gray-500">
        Total Satellites: {summary.total}
      </div>
    </div>
  );
}
