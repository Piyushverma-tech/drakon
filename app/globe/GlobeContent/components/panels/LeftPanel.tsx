import React, { memo, useState, useCallback } from 'react';
import { Satellite, X, ChevronRight } from 'lucide-react';
import { ReentryRisk, SatelliteMetadata } from '@/lib/types';

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
  metaData?: SatelliteMetadata | null;
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

function SectionLabel({
  children,
  collapsible = false,
  open = true,
  onToggle,
}: {
  children: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  if (!collapsible) {
    return (
      <div className="flex items-center gap-2 mb-1 mt-3 first:mt-0">
        <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 font-semibold">
          {children}
        </span>
        <div className="flex-1 h-px bg-gray-700/60" />
      </div>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 mb-1 mt-3 first:mt-0 group cursor-pointer"
    >
      <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 font-semibold group-hover:text-cyan-300 transition-colors">
        {children}
      </span>
      <div className="flex-1 h-px bg-gray-700/60" />
      <ChevronRight
        size={12}
        className={`text-gray-500 group-hover:text-cyan-400 shrink-0 transition-all duration-200 ${open ? 'rotate-90' : 'rotate-0'}`}
      />
    </button>
  );
}

function formatOptional(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function formatMass(value: number | undefined): string {
  if (!value) return '—';
  return `${Math.round(value).toLocaleString()} kg`;
}

// Which sections are open by default
const DEFAULT_OPEN: Record<string, boolean> = {
  mission: false,
  catalog: false,
  launch: false,
  position: true,
  dynamics: true,
  orbit: true,
  reentry: true,
  tle: false,
};

const LeftPanel = memo(function LeftPanel({
  selected,
  onClose,
  reentryRisk,
  metaData,
}: Props) {
  const [openSections, setOpenSections] =
    useState<Record<string, boolean>>(DEFAULT_OPEN);

  const toggle = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!selected) return null;

  const hasReentry = reentryRisk && reentryRisk.tier !== 'stable';

  return (
    <div className="absolute left-3 top-3 w-64 z-10 select-none">
      {/* Outer shell */}
      <div className="relative bg-black/60 backdrop-blur-md border border-white/10 flex flex-col max-h-[calc(100vh-4rem)]">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400 pointer-events-none" />
        <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400 pointer-events-none" />

        {/* Header — always visible, never scrolls */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
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

        {/* NORAD badge — always visible */}
        <div className="px-3 shrink-0">
          <div className="flex items-center gap-2 py-1.5 border-b border-white/5">
            <span className="text-[10px] uppercase tracking-widest text-gray-400">
              NORAD
            </span>
            <span className="ml-auto text-[11px] font-mono text-white/90 bg-white/5 border border-white/10 px-1.5 py-0.5 tracking-wider">
              #{selected.id}
            </span>
          </div>
        </div>

        {/* Re-entry risk badge — always visible if present */}
        {hasReentry && (
          <div className="px-3 py-1.5 shrink-0">
            <div
              className={`flex items-center justify-between px-2 py-1 border ${
                reentryRisk.tier === 'critical'
                  ? 'border-red-500/40 bg-red-500/10'
                  : reentryRisk.tier === 'warning'
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-yellow-500/40 bg-yellow-500/10'
              }`}
            >
              <span className="text-[9px] uppercase tracking-widest text-gray-400">
                Re-entry Risk
              </span>
              <span
                className={`text-[11px] font-semibold uppercase tracking-wider ${
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
          </div>
        )}

        {/* Scrollable body */}
        <div className="overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent px-3 pb-3 pt-1 flex-1 min-h-0">
          {/* POSITION — open by default */}
          <SectionLabel
            collapsible
            open={openSections.position}
            onToggle={() => toggle('position')}
          >
            Position
          </SectionLabel>
          {openSections.position && (
            <>
              <StatRow label="Lat" value={`${selected.lat.toFixed(4)}°`} />
              <StatRow label="Lon" value={`${selected.lon.toFixed(4)}°`} />
              <StatRow
                label="Alt"
                value={`${Math.round(selected.alt).toLocaleString()} km`}
                accent
              />
            </>
          )}

          {/* DYNAMICS — open by default */}
          <SectionLabel
            collapsible
            open={openSections.dynamics}
            onToggle={() => toggle('dynamics')}
          >
            Dynamics
          </SectionLabel>
          {openSections.dynamics && (
            <>
              <StatRow
                label="Velocity"
                value={`${selected.vel.toFixed(3)} km/s`}
                accent
              />
              <StatRow
                label="Incl."
                value={`${selected.inclination.toFixed(2)}°`}
              />
            </>
          )}

          {/* ORBIT — open by default */}
          <SectionLabel
            collapsible
            open={openSections.orbit}
            onToggle={() => toggle('orbit')}
          >
            Orbit
          </SectionLabel>
          {openSections.orbit && (
            <StatRow label="Type" value={selected.orbitType} accent />
          )}

          {/* RE-ENTRY detail — open by default if present */}
          {hasReentry && (
            <>
              <SectionLabel
                collapsible
                open={openSections.reentry}
                onToggle={() => toggle('reentry')}
              >
                Re-entry Detail
              </SectionLabel>
              {openSections.reentry && (
                <>
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
            </>
          )}

          {/* MISSION — collapsed by default */}
          {metaData && (
            <>
              <SectionLabel
                collapsible
                open={openSections.mission}
                onToggle={() => toggle('mission')}
              >
                Mission
              </SectionLabel>
              {openSections.mission && (
                <>
                  <StatRow
                    label="Operator"
                    value={formatOptional(metaData.operator)}
                  />
                  <StatRow
                    label="Country"
                    value={formatOptional(
                      metaData.country ?? metaData.countryCode
                    )}
                  />
                  <StatRow
                    label="Purpose"
                    value={formatOptional(metaData.purpose)}
                  />
                  <StatRow
                    label="Users"
                    value={formatOptional(metaData.userType)}
                  />
                </>
              )}

              {/* CATALOG — collapsed by default */}
              <SectionLabel
                collapsible
                open={openSections.catalog}
                onToggle={() => toggle('catalog')}
              >
                Catalog
              </SectionLabel>
              {openSections.catalog && (
                <>
                  <StatRow
                    label="Object"
                    value={formatOptional(metaData.objectType)}
                  />
                  <StatRow
                    label="COSPAR"
                    value={formatOptional(metaData.cosparId)}
                  />
                  <StatRow
                    label="Apogee"
                    value={`${formatOptional(metaData.apogeeKm)} km`}
                  />
                  <StatRow
                    label="Perigee"
                    value={`${formatOptional(metaData.perigeeKm)} km`}
                  />
                  <StatRow
                    label="Period"
                    value={`${formatOptional(metaData.periodMinutes)} min`}
                  />
                  <StatRow
                    label="Source"
                    value={metaData.source.toUpperCase()}
                  />
                </>
              )}

              {/* LAUNCH — collapsed by default */}
              <SectionLabel
                collapsible
                open={openSections.launch}
                onToggle={() => toggle('launch')}
              >
                Launch
              </SectionLabel>
              {openSections.launch && (
                <>
                  <StatRow
                    label="Date"
                    value={formatOptional(metaData.launchDate)}
                  />
                  <StatRow
                    label="Site"
                    value={formatOptional(metaData.launchSite)}
                  />
                  <StatRow
                    label="Vehicle"
                    value={formatOptional(metaData.launchVehicle)}
                  />
                  <StatRow label="Mass" value={formatMass(metaData.massKg)} />
                </>
              )}
            </>
          )}

          {/* TLE — collapsed by default */}
          <SectionLabel
            collapsible
            open={openSections.tle}
            onToggle={() => toggle('tle')}
          >
            TLE
          </SectionLabel>
          {openSections.tle && (
            <>
              {selected.tleEpoch && (
                <StatRow label="Epoch" value={selected.tleEpoch} />
              )}
              {metaData?.decayDate && (
                <StatRow label="Decay" value={metaData.decayDate} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default LeftPanel;
