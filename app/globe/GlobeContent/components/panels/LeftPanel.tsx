import React, { memo } from 'react';
import { Satellite, X } from 'lucide-react';
import { ReentryRisk } from '@/lib/types';

type SelectedMeta = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  inclination: number;
  orbitType: string;
  tleEpoch?: string;
};

type Props = {
  selected: SelectedMeta | null;
  setSelected: (meta: SelectedMeta | null) => void;
  onClose: () => void;
  reentryRisk: ReentryRisk | null;
};

function StatRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 group">
      <span className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
        {label}
      </span>
      <span
        className={`text-xs text-end tabular-nums ${accent ? 'text-cyan-300' : 'text-gray-200'}`}
      >
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1 mt-3 first:mt-0">
      <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 font-semibold">
        {children}
      </span>
      <div className="flex-1 h-px bg-gray-700/60" />
    </div>
  );
}

const LeftPanel = memo(function LeftPanel({
  selected,
  onClose,
  reentryRisk,
}: Props) {
  if (!selected) return null;

  return (
    <div className="absolute left-3 top-3 w-56 z-10 select-none">
      {/* Outer shell */}
      <div className="relative bg-black/60 backdrop-blur-md border border-white/10">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
        <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Satellite size={18} className="text-cyan-400 shrink-0" />
            <span
              className="text-[14px] font-semibold uppercase tracking-widest text-cyan-300 truncate"
              title={selected.name}
            >
              {selected.name}
            </span>
          </div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 text-gray-600 hover:text-red-400 transition-colors duration-150"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-3 pb-3 pt-1">
          {/* ID badge */}
          <div className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-400">
              NORAD
            </span>
            <span className="ml-auto text-[11px] font-mono text-white/90 bg-white/5 border border-white/10 px-1.5 py-0.5 tracking-wider">
              #{selected.id}
            </span>
          </div>

          {/* Position */}
          <SectionLabel>Position</SectionLabel>
          <StatRow label="Lat" value={`${selected.lat.toFixed(4)}°`} />
          <StatRow label="Lon" value={`${selected.lon.toFixed(4)}°`} />
          <StatRow
            label="Alt"
            value={`${Math.round(selected.alt).toLocaleString()} km`}
            accent
          />

          {/* Dynamics */}
          <SectionLabel>Dynamics</SectionLabel>
          <StatRow
            label="Velocity"
            value={`${selected.vel.toFixed(3)} km/s`}
            accent
          />
          <StatRow
            label="Incl."
            value={`${selected.inclination.toFixed(2)}°`}
          />

          {/* Orbit */}
          <SectionLabel>Orbit</SectionLabel>
          <StatRow label="Type" value={selected.orbitType} accent />

          {/* Re-entry risk */}
          {reentryRisk && reentryRisk.tier !== 'stable' && (
            <>
              <SectionLabel>Re-entry</SectionLabel>
              <div className="flex items-center justify-between py-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                  Risk
                </span>
                <span
                  className={`text-xs font-semibold capitalize ${
                    reentryRisk.tier === 'critical'
                      ? 'text-red-400'
                      : reentryRisk.tier === 'warning'
                        ? 'text-amber-400'
                        : 'text-yellow-300'
                  }`}
                >
                  {reentryRisk.tier}
                </span>
              </div>
              {reentryRisk.estimatedDaysRemaining !== null && (
                <StatRow
                  label="Est. lifetime"
                  value={`~${reentryRisk.estimatedDaysRemaining}d`}
                  accent={reentryRisk.tier === 'critical'}
                />
              )}
              <StatRow
                label="BSTAR"
                value={reentryRisk.bstar.toExponential(2)}
              />
              <StatRow
                label="Decay rate"
                value={`${reentryRisk.decayRateKmPerDay.toFixed(2)} km/day`}
              />
            </>
          )}
          <SectionLabel>TLE</SectionLabel>
          {selected.tleEpoch && (
            <StatRow label="Epoch" value={selected.tleEpoch} />
          )}
        </div>
      </div>
    </div>
  );
});

export default LeftPanel;
