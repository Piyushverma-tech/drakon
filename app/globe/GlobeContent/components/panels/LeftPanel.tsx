import React, { memo, useState, useCallback } from 'react';
import {
  Satellite,
  ChevronRight,
  Eye,
  EyeClosed,
  TrainTrack,
  Orbit,
} from 'lucide-react';
import { ReentryRisk, SatelliteMetadata } from '@/lib/types';
import { SelectedMeta } from '../../GlobeContainer';

type Props = {
  selected: SelectedMeta | null;
  reentryRisk: ReentryRisk | null;
  metadata?: SatelliteMetadata | null;
  isFollowingSelected: boolean;
  onToggleFollow: () => void;
  showTrack: boolean;
  onToggleTrack: () => void;
  showOrbitPath: boolean;
  onToggleOrbitPath: () => void;
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
      <div className="flex items-center gap-2 mb-1 mt-2 first:mt-0">
        <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-semibold">
          {children}
        </span>
        <div className="flex-1 h-px bg-gray-700/60" />
      </div>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 mb-1 mt-2 first:mt-0 group cursor-pointer"
    >
      <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-semibold group-hover:text-cyan-300 transition-colors">
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
  if (value === undefined) return '—';
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatUnit(
  value: string | number | null | undefined,
  unit: string
): string {
  const formatted = formatOptional(value);
  return formatted === '—' ? formatted : `${formatted} ${unit}`;
}

function formatConfidence(confidence: ReentryRisk['confidence']): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
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
  reentryRisk,
  metadata,
  isFollowingSelected,
  onToggleFollow,
  showTrack,
  onToggleTrack,
  showOrbitPath,
  onToggleOrbitPath,
}: Props) {
  const [openSections, setOpenSections] =
    useState<Record<string, boolean>>(DEFAULT_OPEN);

  const toggle = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!selected) return null;

  const hasReentry = reentryRisk && reentryRisk.tier !== 'stable';

  return (
    <div className="absolute left-3 top-3 w-[280px] z-10 select-none">
      {/* Outer shell */}
      <div className="relative bg-black/60 backdrop-blur-md border border-white/10 flex flex-col max-h-[calc(97vh-4rem)]">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400 pointer-events-none" />
        <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400 pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Satellite size={18} className="text-cyan-400 shrink-0" />
            <span
              className="text-[14px] font-semibold uppercase tracking-widest text-cyan-300 truncate"
              title={selected.name}
            >
              {selected.name}
            </span>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-1" />
        </div>

        <div className="flex items-center px-3 pt-1 pb-2 gap-2">
          <button
            type="button"
            onClick={onToggleFollow}
            title={
              isFollowingSelected ? 'Turn off Tracking' : 'Turn on Tracking'
            }
            aria-pressed={isFollowingSelected}
            className={`flex h-6 w-8 items-center justify-center border rounded-sm transition-colors duration-150 cursor-pointer ${
              isFollowingSelected
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                : 'border-white/20 bg-white/5 text-gray-400 hover:border-cyan-400/30 hover:text-cyan-300'
            }`}
          >
            {isFollowingSelected ? <Eye size={16} /> : <EyeClosed size={15} />}
          </button>
          <button
            type="button"
            onClick={onToggleTrack}
            title={showTrack ? 'Hide Track' : 'Show Track'}
            aria-pressed={showTrack}
            className={`flex h-6 w-8 items-center justify-center border rounded-sm transition-colors duration-150 cursor-pointer ${
              showTrack
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                : 'border-white/20 bg-white/5 text-gray-400 hover:border-cyan-400/30 hover:text-cyan-300'
            }`}
          >
            <TrainTrack size={16} />
          </button>
          <button
            type="button"
            onClick={onToggleOrbitPath}
            title={showOrbitPath ? 'Hide 3D Orbit' : 'Show 3D Orbit'}
            aria-pressed={showOrbitPath}
            className={`flex h-6 w-8 items-center justify-center border rounded-sm transition-colors duration-150 cursor-pointer ${
              showOrbitPath
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                : 'border-white/20 bg-white/5 text-gray-400 hover:border-cyan-400/30 hover:text-cyan-300'
            }`}
          >
            <Orbit size={16} />
          </button>
        </div>
        {/* NORAD badge — always visible */}
        <div className="px-3 shrink-0">
          <div className="flex items-center gap-2 py-1.5">
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
            <>
              <StatRow label="Type" value={selected.orbitType} accent />
              <StatRow label="Ecc." value={selected.ecc.toFixed(5)} />
              <StatRow
                label="Perigee"
                value={`${Math.round(selected.perigeeKm).toLocaleString()} km`}
              />
              <StatRow
                label="Apogee"
                value={`${Math.round(selected.apogeeKm).toLocaleString()} km`}
              />
            </>
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
                    label="Probability"
                    value={formatConfidence(reentryRisk.confidence)}
                    accent={reentryRisk.confidence === 'high'}
                  />
                  <StatRow
                    label="N-dot"
                    value={reentryRisk.signalsAgree ? 'Agrees' : 'Disagrees'}
                  />
                  <StatRow
                    label="BSTAR"
                    value={reentryRisk.bstar.toExponential(2)}
                  />
                  <StatRow
                    label="N-dot value"
                    value={reentryRisk.meanMotionDot.toExponential(2)}
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
          {metadata && (
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
                    value={formatOptional(metadata.operator)}
                  />
                  <StatRow
                    label="Country"
                    value={formatOptional(
                      metadata.country ?? metadata.countryCode
                    )}
                  />
                  <StatRow
                    label="Purpose"
                    value={formatOptional(metadata.purpose)}
                  />
                  <StatRow
                    label="Users"
                    value={formatOptional(metadata.userType)}
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
                    value={formatOptional(metadata.objectType)}
                  />
                  <StatRow
                    label="COSPAR"
                    value={formatOptional(metadata.cosparId)}
                  />

                  <StatRow
                    label="Period"
                    value={formatUnit(metadata.periodMinutes, 'min')}
                  />
                  <StatRow
                    label="Source"
                    value={metadata.source.toUpperCase()}
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
                    value={formatOptional(metadata.launchDate)}
                  />
                  <StatRow
                    label="Site"
                    value={formatOptional(metadata.launchSite)}
                  />
                  <StatRow
                    label="Vehicle"
                    value={formatOptional(metadata.launchVehicle)}
                  />
                  <StatRow label="Mass" value={formatMass(metadata.massKg)} />
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
              {metadata?.decayDate && (
                <StatRow label="Decay" value={metadata.decayDate} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default LeftPanel;
