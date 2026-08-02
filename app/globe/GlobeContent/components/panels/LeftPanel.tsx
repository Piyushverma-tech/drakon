import React, { memo, useState, useCallback } from 'react';
import {
  Satellite,
  ChevronRight,
  Eye,
  EyeClosed,
  TrainTrack,
  Orbit,
  TrendingDown,
  FileDown,
} from 'lucide-react';
import { ReentryRisk, SatelliteMetadata } from '@/lib/types';
import { SelectedMeta } from '../../globe-model';
import Link from 'next/link';
import { FlightDynamicsCanvas } from '@/components/FlightDynamics';
import { formatFlightPathAngleDeg } from '@/lib/orbitalFrame';

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

function formatSignal(signal: string | undefined): string {
  if (!signal) return 'Single epoch';
  return signal.replace(/_/g, ' ');
}

type CsvRow = {
  section: string;
  label: string;
  value: string;
};

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: CsvRow[]) {
  const header = ['Section', 'Field', 'Value'];
  const csv = [
    header.map(csvEscape).join(','),
    ...rows.map((row) =>
      [row.section, row.label, row.value].map(csvEscape).join(',')
    ),
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
}

// Which sections are open by default
const DEFAULT_OPEN: Record<string, boolean> = {
  mission: false,
  catalog: false,
  launch: false,
  position: true,
  dynamics: true,
  orbit: true,
  reentry: false,
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
  const exportRows: CsvRow[] = [
    { section: 'Satellite', label: 'Name', value: selected.name },
    { section: 'Satellite', label: 'NORAD', value: String(selected.id) },

    { section: 'Position', label: 'Lat', value: `${selected.lat.toFixed(4)}°` },
    { section: 'Position', label: 'Lon', value: `${selected.lon.toFixed(4)}°` },
    {
      section: 'Position',
      label: 'Alt',
      value: `${Math.round(selected.alt).toLocaleString()} km`,
    },
    {
      section: 'Dynamics',
      label: 'Velocity',
      value: `${selected.vel.toFixed(3)} km/s`,
    },
    {
      section: 'Dynamics',
      label: 'Incl.',
      value: `${selected.inclination.toFixed(2)}°`,
    },
    {
      section: 'Dynamics',
      label: 'Flight-path angle',
      value: formatFlightPathAngleDeg(selected.orbitalFrame),
    },
    { section: 'Orbit', label: 'Type', value: selected.orbitType },
    { section: 'Orbit', label: 'Ecc.', value: selected.ecc.toFixed(5) },
    {
      section: 'Orbit',
      label: 'Perigee',
      value: `${Math.round(selected.perigeeKm).toLocaleString()} km`,
    },
    {
      section: 'Orbit',
      label: 'Apogee',
      value: `${Math.round(selected.apogeeKm).toLocaleString()} km`,
    },
    { section: 'Orbit', label: 'RAAN', value: `${selected.raan.toFixed(2)}°` },
    {
      section: 'Orbit',
      label: 'Arg. Perigee',
      value: `${selected.argPerigee.toFixed(2)}°`,
    },
    {
      section: 'Orbit',
      label: 'Mean Motion',
      value: `${selected.meanMotion.toFixed(2)} rev/day`,
    },
  ];

  if (hasReentry) {
    exportRows.push(
      { section: 'Re-entry Risk', label: 'Tier', value: reentryRisk.tier },
      ...(reentryRisk.estimatedDaysRemaining !== null
        ? [
            {
              section: 'Re-entry Detail',
              label: 'Est. lifetime',
              value: `~${reentryRisk.estimatedDaysRemaining}d`,
            },
          ]
        : []),
      {
        section: 'Re-entry Detail',
        label: 'Probability',
        value: formatConfidence(reentryRisk.confidence),
      },
      {
        section: 'Re-entry Detail',
        label: 'Signal',
        value: formatSignal(reentryRisk.decaySignal),
      },
      ...(reentryRisk.decayConfidence !== undefined
        ? [
            {
              section: 'Re-entry Detail',
              label: 'Trend conf.',
              value: `${Math.round((reentryRisk.decayConfidence ?? 0) * 100)}%`,
            },
          ]
        : []),
      ...(reentryRisk.epochsAvailable !== undefined
        ? [
            {
              section: 'Re-entry Detail',
              label: 'Epochs',
              value: `${reentryRisk.epochsAvailable}`,
            },
          ]
        : []),
      ...(reentryRisk.historyDaysAvailable !== undefined
        ? [
            {
              section: 'Re-entry Detail',
              label: 'History',
              value: `${reentryRisk.historyDaysAvailable.toFixed(1)}d`,
            },
          ]
        : []),
      ...(reentryRisk.estimatedReentryAt
        ? [
            {
              section: 'Re-entry Detail',
              label: 'Est. date',
              value: new Date(reentryRisk.estimatedReentryAt)
                .toISOString()
                .slice(0, 10),
            },
          ]
        : []),
      {
        section: 'Re-entry Detail',
        label: 'N-dot',
        value: reentryRisk.signalsAgree ? 'Agrees' : 'Disagrees',
      },
      {
        section: 'Re-entry Detail',
        label: 'BSTAR',
        value: reentryRisk.bstar.toExponential(2),
      },
      {
        section: 'Re-entry Detail',
        label: 'N-dot value',
        value: reentryRisk.meanMotionDot.toExponential(2),
      },
      {
        section: 'Re-entry Detail',
        label: 'Decay rate',
        value: `${reentryRisk.decayRateKmPerDay.toFixed(2)} km/day`,
      }
    );
  }

  if (metadata) {
    exportRows.push(
      {
        section: 'Mission',
        label: 'Operator',
        value: formatOptional(metadata.operator),
      },
      {
        section: 'Mission',
        label: 'Country',
        value: formatOptional(metadata.country ?? metadata.countryCode),
      },
      {
        section: 'Mission',
        label: 'Purpose',
        value: formatOptional(metadata.purpose),
      },
      {
        section: 'Mission',
        label: 'Users',
        value: formatOptional(metadata.userType),
      },
      {
        section: 'Catalog',
        label: 'Object',
        value: formatOptional(metadata.objectType),
      },
      {
        section: 'Catalog',
        label: 'COSPAR',
        value: formatOptional(metadata.cosparId),
      },
      {
        section: 'Catalog',
        label: 'Period',
        value: formatUnit(metadata.periodMinutes, 'min'),
      },
      {
        section: 'Catalog',
        label: 'Source',
        value: metadata.source.toUpperCase(),
      },
      {
        section: 'Launch',
        label: 'Date',
        value: formatOptional(metadata.launchDate),
      },
      {
        section: 'Launch',
        label: 'Site',
        value: formatOptional(metadata.launchSite),
      },
      {
        section: 'Launch',
        label: 'Vehicle',
        value: formatOptional(metadata.launchVehicle),
      },
      {
        section: 'Launch',
        label: 'Mass',
        value: formatMass(metadata.massKg),
      }
    );
  }

  if (selected.tleEpoch) {
    exportRows.push({
      section: 'TLE',
      label: 'Epoch',
      value: selected.tleEpoch,
    });
  }

  if (metadata?.decayDate) {
    exportRows.push({
      section: 'TLE',
      label: 'Decay',
      value: metadata.decayDate,
    });
  }

  exportRows.push(
    { section: 'TLE', label: 'Line 1', value: selected.l1 },
    { section: 'TLE', label: 'Line 2', value: selected.l2 }
  );

  const handleExportCsv = () => {
    downloadCsv(
      `${safeFilename(selected.name) || `satellite_${selected.id}`}_${selected.id}_DRAKON.csv`,
      exportRows
    );
  };

  return (
    <div className="absolute left-3 top-3 w-[300px] z-10 select-text">
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
          <div className="ml-2 flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleExportCsv}
              title="Export"
              className="flex items-center justify-center p-1 duration-150 cursor-pointer text-gray-400/80 hover:text-cyan-400"
            >
              <FileDown size={19} />
            </button>
          </div>
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
          {hasReentry && (
            <Link
              href={`/dashboard/reentry/${selected.id}`}
              type="button"
              title="View Re-entry Analysis"
              className={`flex h-6 w-8 items-center justify-center border rounded-sm transition-colors duration-150 cursor-pointer ${
                reentryRisk.tier === 'critical'
                  ? 'border-red-500/40 bg-red-500/10'
                  : reentryRisk.tier === 'warning'
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-yellow-500/40 bg-yellow-500/10'
              }`}
            >
              <TrendingDown size={16} />
            </Link>
          )}
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
          <div
            className={`shrink-0 px-2 py-2 border ${
              reentryRisk.tier === 'critical'
                ? 'border-red-500/40 bg-red-500/10'
                : reentryRisk.tier === 'warning'
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-yellow-500/40 bg-yellow-500/10'
            }`}
          >
            <div className={`flex items-center justify-between  `}>
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
                  label="Signal"
                  value={formatSignal(reentryRisk.decaySignal)}
                  accent={reentryRisk.source === 'multi_epoch'}
                />
                {reentryRisk.decayConfidence !== undefined && (
                  <StatRow
                    label="Trend conf."
                    value={`${Math.round((reentryRisk.decayConfidence ?? 0) * 100)}%`}
                  />
                )}
                {reentryRisk.epochsAvailable !== undefined && (
                  <StatRow
                    label="Epochs"
                    value={`${reentryRisk.epochsAvailable}`}
                  />
                )}
                {reentryRisk.historyDaysAvailable !== undefined && (
                  <StatRow
                    label="History"
                    value={`${reentryRisk.historyDaysAvailable.toFixed(1)}d`}
                  />
                )}
                {reentryRisk.estimatedReentryAt && (
                  <StatRow
                    label="Est. date"
                    value={new Date(reentryRisk.estimatedReentryAt)
                      .toISOString()
                      .slice(0, 10)}
                  />
                )}
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
              <FlightDynamicsCanvas
                orbitalFrame={selected.orbitalFrame}
                className="mb-2"
                heightPx={160}
              />
              <StatRow
                label="Velocity"
                value={`${selected.vel.toFixed(3)} km/s`}
                accent
              />
              <StatRow
                label="Incl."
                value={`${selected.inclination.toFixed(2)}°`}
              />
              <StatRow
                label="Flight-path angle"
                value={formatFlightPathAngleDeg(selected.orbitalFrame)}
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
              <StatRow label="RAAN" value={`${selected.raan.toFixed(2)}°`} />
              <StatRow
                label="Arg. Perigee"
                value={`${selected.argPerigee.toFixed(2)}°`}
              />
              <StatRow
                label="mean motion"
                value={`${selected.meanMotion.toFixed(2)} rev/day`}
              />
            </>
          )}

          {/* RE-ENTRY detail — open by default if present */}
          {/* {hasReentry && (
            <>
              
              )}
            </>
          )} */}

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
              <div className="mt-2 space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                  Raw Data
                </div>
                <pre className="whitespace-pre-wrap break-all select-text rounded-sm border border-white/10 bg-white/5 p-2 font-mono text-[9px] leading-relaxed text-gray-300">
                  {selected.l1}
                  {'\n'}
                  {selected.l2}
                </pre>
              </div>
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
