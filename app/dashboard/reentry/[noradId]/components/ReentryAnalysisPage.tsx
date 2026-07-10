'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { AlertTriangle, ArrowRight, Dot } from 'lucide-react';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useObjectTrendsQuery } from '@/hooks/useObjectTrendsQuery';
import { useObjectHistoryQuery } from '@/hooks/useObjectHistoryQuery';
import { useMetadataForSatellite } from '@/hooks/useSatelliteMetadata';
import { resolveReentryRisk } from '@/lib/objectTrendRisk';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import { useAppDispatch } from '@/lib/store';
import {
  selectSingleSatellite,
  setShowReentry,
} from '@/lib/visualization-slice';
import { getOrbitType } from '@/lib/satelliteHelpers';
import { DecisionTrace, TraceStep } from '@/components/DecisionTrace';
import type { TraceStepEmphasis } from '@/components/DecisionTrace';
import { EChart } from '@/components/Charts/Echart';
import { formatAbsoluteUtc, formatRelativeTime } from '../lib/formatTimestamp';
import { buildReentryTrace } from '../lib/buildReentryTrace';
import {
  buildAltitudeChartOption,
  buildBstarChartOption,
} from '../lib/buildReentryChartOptions';

const TIER_BADGE: Record<string, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  nominal: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  stable: 'border-gray-500/40 bg-gray-500/10 text-gray-400',
};

const TIER_EMPHASIS: Record<string, TraceStepEmphasis> = {
  critical: 'critical',
  warning: 'warning',
};

type MetadataRow = {
  label: string;
  value: string | null | undefined;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatKm(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value).toLocaleString()} km`;
}

function formatOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes('T')) return formatAbsoluteUtc(value);
  return value;
}

export function ReentryAnalysisPage({ noradId }: { noradId: number }) {
  const dispatch = useAppDispatch();
  const {
    data: tleData,
    isLoading: tleLoading,
    isError: tleError,
    error: tleErrorObj,
  } = useTleEntriesQuery();
  const { data: objectTrendsById, isFetching: trendsFetching } =
    useObjectTrendsQuery(true);
  const historyQuery = useObjectHistoryQuery(noradId, 30);
  const metadata = useMetadataForSatellite(noradId);

  const entry = useMemo(
    () => tleData?.entries.find((candidate) => candidate.id === noradId),
    [tleData?.entries, noradId]
  );
  const trend = objectTrendsById?.get(noradId);
  const solarFluxMultiplier =
    tleData?.solarFluxMultiplier ?? DEFAULT_SOLAR_FLUX_MULTIPLIER;

  // Same resolveReentryRisk() the dashboard and detail panel already
  // render -- not buildReentryRiskMap(), which deliberately drops
  // tier === 'stable' objects for the list view. This page needs to be
  // able to show any object, including stable ones.
  const risk = useMemo(
    () =>
      entry ? resolveReentryRisk(entry, trend, solarFluxMultiplier) : null,
    [entry, trend, solarFluxMultiplier]
  );

  const trace = useMemo(
    () => (risk ? buildReentryTrace({ risk, trend }) : null),
    [risk, trend]
  );

  const altitudeOption = useMemo(
    () => buildAltitudeChartOption(historyQuery.data?.entries ?? []),
    [historyQuery.data]
  );
  const bstarOption = useMemo(
    () => buildBstarChartOption(historyQuery.data?.entries ?? []),
    [historyQuery.data]
  );

  const handleTrackObject = useCallback(() => {
    dispatch(selectSingleSatellite(noradId));
    dispatch(setShowReentry(true));
  }, [dispatch, noradId]);

  if (tleLoading || trendsFetching) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-400">
        Loading decision trace…
      </div>
    );
  }

  if (tleError) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-red-400">
        {tleErrorObj instanceof Error
          ? tleErrorObj.message
          : 'Unable to load satellite data right now.'}
      </div>
    );
  }

  if (!entry || !risk || !trace) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-400">
        Norad {noradId} is not in the currently tracked catalog.
      </div>
    );
  }

  const badgeClass = TIER_BADGE[trace.verdict.tier] ?? TIER_BADGE.stable;
  const tierEmphasis = TIER_EMPHASIS[trace.verdict.tier] ?? null;
  const displayName =
    entry.name || metadata?.name || metadata?.objectName || `NORAD ${noradId}`;

  const objectType =
    metadata?.objectType ??
    trend?.objectType?.replace('_', ' ').toUpperCase() ??
    (entry.isDebris
      ? 'DEBRIS'
      : getOrbitType(entry.meanMotion, entry.isDebris));

  const periodMinutes =
    metadata?.periodMinutes ??
    (entry.meanMotion > 0 ? 1440 / entry.meanMotion : null);

  const ObjectMetaData: MetadataRow[] = [
    { label: 'Type', value: objectType },
    { label: 'Operator', value: metadata?.operator || entry.operator },
    { label: 'Country', value: metadata?.country ?? metadata?.countryCode },
    {
      label: 'Orbit',
      value:
        metadata?.orbitClass ?? getOrbitType(entry.meanMotion, entry.isDebris),
    },
    { label: 'Perigee', value: formatKm(entry.perigeeKm) },
    { label: 'Period', value: `${formatNumber(periodMinutes, 1)} min` },
    { label: 'Epoch', value: formatOptionalDate(entry.tleEpoch) },
    {
      label: 'Decay rate',
      value: risk.decayRateKmPerDay.toFixed(2) + ' km/day',
    },
  ].filter((row) => row.value && row.value !== '—');

  return (
    <div className="max-w-6xl mx-auto p-6">
      <DecisionTrace
        badge={
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded-full border uppercase tracking-wide ${badgeClass}`}
              >
                {trace.verdict.tier}
              </span>
              <span className="text-[12px] text-gray-400">Norad {noradId}</span>
            </div>
            <Link
              href="/globe"
              onClick={handleTrackObject}
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200 border border-cyan-400/30 px-2.5 py-1"
            >
              Track object
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        }
        headline={displayName}
        subline={
          <div className="flex flex-col">
            <div className="text-[14px] text-gray-400 gap-2 flex flex-wrap items-center">
              <div>{trace.verdict.headline}</div>
              <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
              <div>{trace.verdict.confidenceLine}</div>
              <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
              {trace.computedAt && (
                <div>
                  {'Trend computed '}
                  {formatRelativeTime(trace.computedAt)}
                </div>
              )}
              <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
              {trace.computedAt && (
                <div>
                  {'Version '}
                  {objectTrendsById?.get(noradId)?.trendVersion}
                </div>
              )}
              {!trace.isCurrentModelVersion && (
                <span className="text-amber-400">
                  {' '}
                  · recomputing under a newer model
                </span>
              )}
            </div>
            <span className="flex flex-wrap gap-6 py-6 text-[11px] text-gray-500">
              {ObjectMetaData.map((field) => (
                <span key={field.label} className="whitespace-nowrap space-x-1">
                  <span className="uppercase tracking-wider text-gray-500">
                    {field.label}
                  </span>{' '}
                  <span className="text-gray-300 tabular-nums">
                    {field.value}
                  </span>
                </span>
              ))}
            </span>
          </div>
        }
        callout={
          trace.verdict.callout ? (
            <>
              <AlertTriangle
                className="h-4 w-4 text-gray-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-[13px] text-gray-300">
                {trace.verdict.callout}
              </p>
            </>
          ) : undefined
        }
        evidence={
          <>
            <div className="flex flex-wrap my-6 gap-6">
              <div className="flex-1 min-w-[280px]">
                <p className="text-xs text-gray-500 mb-2">Altitude decay</p>
                <EChart
                  option={altitudeOption}
                  height={240}
                  width={560}
                  loading={historyQuery.isLoading}
                />
              </div>

              <div className="flex-1 min-w-[280px]">
                <p className="text-xs text-gray-500 mb-2">Bstar trend</p>
                <EChart
                  option={bstarOption}
                  height={240}
                  width={560}
                  loading={historyQuery.isLoading}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-10">
              {trend?.epochsAvailable ?? '—'} epochs
              {' · '}
              {trend?.historyDaysAvailable ?? '—'} days history
              {trace.computedAt && (
                <> · trend computed at {formatAbsoluteUtc(trace.computedAt)}</>
              )}
            </p>
          </>
        }
      >
        {trace.steps.map((step) => (
          <TraceStep
            key={step.id}
            icon={step.icon}
            status={step.status}
            claim={step.claim}
            detail={step.detail}
            emphasis={step.id === 'tier' ? tierEmphasis : null}
          />
        ))}
      </DecisionTrace>
    </div>
  );
}
