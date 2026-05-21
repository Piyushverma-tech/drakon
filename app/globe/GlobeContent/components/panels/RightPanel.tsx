import { useAppDispatch, useAppSelector } from '@/lib/store';
import { DensityResult, ReentryRisk, TleEntry } from '@/lib/types';
import {
  setBandInclination,
  setBandTolerance,
  setDensityRadiusKm,
  setOverviewExpanded,
  setShowBands,
  setShowDensity,
  setShowReentry,
  toggleFilter,
} from '@/lib/visualization-slice';
import { ArrowBigDown, ArrowBigUp, Loader2 } from 'lucide-react';
import { memo } from 'react';
import DensityLegend from '../DensityLegend';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';

type Props = {
  stats: {
    leo: number;
    meo: number;
    geo: number;
    debris: number;
    total: number;
    filtered: number;
  };
  bandCount: number;
  bandAvgAltKm: number;
  bandTrackLoading: boolean;
  densityResult: DensityResult | null;
  densityLoading: boolean;
  densityError: string | null;
  formatDistance: (d: number) => string;
  reentryRisks: Map<number, ReentryRisk>;
  showReentry: boolean;
  onFocusSatellite: (sat: TleEntry) => void;
};

function RightPanel({
  stats,
  bandCount,
  bandAvgAltKm,
  bandTrackLoading,
  densityResult,
  densityLoading,
  densityError,
  formatDistance,
  reentryRisks,
  showReentry,
  onFocusSatellite,
}: Props) {
  const dispatch = useAppDispatch();
  const {
    activeFilters,
    overviewExpanded,
    showBands,
    bandInclination,
    bandTolerance,
    showDensity,
    densityRadiusKm,
  } = useAppSelector((state) => state.visualization);
  const { data: queriedEntries } = useTleEntriesQuery();
  const entries = queriedEntries ?? [];

  const activeFiltersSet = new Set(activeFilters);

  return (
    <div className="absolute right-3 top-3 w-[280px] bg-black/60 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto max-h-[calc(100vh-4rem)] z-10">
      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
      <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

      <>
        {/* Orbit Filters */}

        <div
          className="font-medium text-cyan-300 text-xs uppercase tracking-wider flex justify-between items-center cursor-pointer"
          onClick={() => dispatch(setOverviewExpanded(!overviewExpanded))}
        >
          <span>Objects Overview</span>
          <span className="text-cyan-300">
            {overviewExpanded ? (
              <ArrowBigDown className="w-4 h-4" />
            ) : (
              <ArrowBigUp className="w-4 h-4" />
            )}
          </span>
        </div>
        {overviewExpanded && (
          <>
            <div className="grid grid-cols-2 gap-2 my-4">
              {[
                {
                  type: 'LEO',
                  color: 'bg-red-500',
                  label: 'LEO',
                  stats: `${stats.leo}`,
                },
                {
                  type: 'MEO',
                  color: 'bg-orange-400',
                  label: 'MEO',
                  stats: `${stats.meo}`,
                },
                {
                  type: 'GEO',
                  color: 'bg-green-500',
                  label: 'GEO',
                  stats: `${stats.geo}`,
                },
                {
                  type: 'Debris',
                  color: 'bg-gray-400',
                  label: 'Debris',
                  stats: `${stats.debris}`,
                },
              ].map(({ type, color, label, stats }) => (
                <button
                  key={type}
                  onClick={() => dispatch(toggleFilter(type))}
                  className={`flex items-center gap-1 px-2 py-[3px] text-[11px] transition-all duration-200 cursor-pointer ${
                    activeFiltersSet.has(type)
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/50'
                      : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50 hover:text-gray-300'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${color}`} />
                  {label}
                  <span className="ml-auto">{stats}</span>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-300 mt-1 mb-3">
              Showing: {stats.filtered} of {stats.total}
            </div>

            {/* Inclination bands controls */}
            <div className="mt-2 pt-2 border-t border-gray-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-cyan-300 text-xs uppercase tracking-wider">
                  Inclination Bands
                </span>
                <button
                  type="button"
                  onClick={() => dispatch(setShowBands(!showBands))}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                    showBands
                      ? 'bg-cyan-500/30 text-cyan-200 border-cyan-400/60'
                      : 'bg-gray-800/60 text-gray-300 border-gray-600 hover:bg-gray-700/60'
                  }`}
                >
                  {showBands ? 'On' : 'Off'}
                </button>
              </div>

              {showBands && (
                <div className="space-y-3">
                  {/* Inclination Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-300">
                      <span>Inclination</span>
                      <span>{bandInclination.toFixed(1)}°</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={0.5}
                      value={bandInclination}
                      onChange={(e) =>
                        dispatch(setBandInclination(parseFloat(e.target.value)))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>

                  {/* Tolerance Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-300">
                      <span>Tolerance (±)</span>
                      <span>{bandTolerance.toFixed(1)}°</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={bandTolerance}
                      onChange={(e) =>
                        dispatch(setBandTolerance(parseFloat(e.target.value)))
                      }
                      className="w-full accent-cyan-400"
                    />
                    <div className="text-[10px] text-gray-400">
                      {bandInclination.toFixed(1)}° ± {bandTolerance.toFixed(1)}
                      °
                    </div>
                  </div>

                  {bandTrackLoading && (
                    <div className="text-[10px] text-cyan-400/70 mt-2">
                      Generating ground track...
                    </div>
                  )}

                  {bandCount > 0 && (
                    <div className="mt-1 rounded border border-cyan-500/40 bg-black/40 px-2 py-1.5 text-[11px] text-cyan-100 space-y-1">
                      <div className="flex  text-xs text-gray-300 justify-between">
                        <span>Satellites</span>
                        <span>{bandCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg Altitude</span>
                        <span>{Math.round(bandAvgAltKm)} km</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Re-entry Risk Screening */}
            <div className="mt-2 border-t border-gray-700/60 pt-2">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-medium text-cyan-300 uppercase tracking-wider">
                  Re-entry Risk
                </span>
                <button
                  type="button"
                  onClick={() => dispatch(setShowReentry(!showReentry))}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                    showReentry
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                      : 'bg-gray-800/60 text-gray-300 border-gray-600 hover:bg-gray-700/60'
                  }`}
                >
                  {showReentry ? 'On' : 'Off'}
                </button>
              </div>

              {showReentry && (
                <div className="space-y-2 text-[11px] text-gray-300">
                  {/* Summary counts */}
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {(['critical', 'warning', 'nominal'] as const).map(
                      (tier) => {
                        const count = [...reentryRisks.values()].filter(
                          (r) => r.tier === tier
                        ).length;
                        const colors = {
                          critical: 'text-red-400',
                          warning: 'text-amber-400',
                          nominal: 'text-yellow-300',
                        };
                        return (
                          <div
                            key={tier}
                            className="rounded border border-gray-700/60 px-1 py-1.5"
                          >
                            <div
                              className={`text-sm font-semibold ${colors[tier]}`}
                            >
                              {count}
                            </div>
                            <div className="text-[9px] text-gray-400 capitalize">
                              {tier}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>

                  {/* Disclaimer */}
                  <div className="text-[9px] text-gray-500 leading-relaxed">
                    Estimates from BSTAR drag term + N-dot confidence signal.
                    Accuracy ±order of magnitude. Solar activity not modeled.
                  </div>

                  {/* Top at-risk list */}
                  {reentryRisks.size > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="uppercase tracking-wider text-gray-400 text-[10px]">
                        Top 50 Soonest re-entry
                      </div>
                      <div className="max-h-52 overflow-auto space-y-1 pr-1">
                        {[...reentryRisks.values()]
                          .filter((r) => r.estimatedDaysRemaining !== null)
                          .sort(
                            (a, b) =>
                              (a.estimatedDaysRemaining ?? Infinity) -
                              (b.estimatedDaysRemaining ?? Infinity)
                          )
                          .slice(0, 50)
                          .map((risk) => {
                            const entry = entries.find(
                              (e) => e.id === risk.satId
                            );
                            const tierColor =
                              risk.tier === 'critical'
                                ? 'text-red-400'
                                : risk.tier === 'warning'
                                  ? 'text-amber-400'
                                  : 'text-yellow-300';

                            return (
                              <div
                                key={risk.satId}
                                className="flex items-center justify-between rounded border border-gray-700/60 px-2 py-1 cursor-pointer hover:border-cyan-400/30 hover:bg-cyan-500/10 transition-colors"
                                onClick={() => entry && onFocusSatellite(entry)}
                              >
                                <div className="flex flex-col min-w-0">
                                  <span className="text-gray-200 truncate text-[10px]">
                                    {entry?.name ?? `#${risk.satId}`}
                                  </span>
                                  <span className="text-[9px] text-gray-400">
                                    ~{Math.round(risk.decayAltKm)} km alt
                                  </span>
                                </div>

                                <div
                                  className={`text-right shrink-0 ml-2 ${tierColor}`}
                                >
                                  {risk.estimatedDaysRemaining === 0
                                    ? '<1d'
                                    : `~${risk.estimatedDaysRemaining}d`}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Collision Density Map */}
            <div className="mt-2 border-t border-gray-700/60 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-medium text-cyan-300 uppercase tracking-wider">
                    Collision Density Map
                  </span>
                  <button
                    type="button"
                    onClick={() => dispatch(setShowDensity(!showDensity))}
                    className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                      showDensity
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                        : 'bg-gray-800/60 text-gray-300 border-gray-600 hover:bg-gray-700/60'
                    }`}
                  >
                    {showDensity ? 'On' : 'Off'}
                  </button>
                </div>

                {showDensity && (
                  <div className="space-y-2 mt-3 text-[11px] text-gray-300">
                    <div className="flex items-center justify-between">
                      <span>Detection Radius</span>
                      <span>{densityRadiusKm.toFixed(0)} km</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={250}
                      step={5}
                      value={densityRadiusKm}
                      onChange={(e) =>
                        dispatch(setDensityRadiusKm(parseFloat(e.target.value)))
                      }
                      className="w-full accent-cyan-400"
                    />
                    <div className="text-[10px] text-gray-400">
                      Larger radius captures more potential close approaches.
                    </div>

                    {/* Density Color Legend */}
                    <DensityLegend />

                    <div className="text-[11px] min-h-10 text-gray-200">
                      {densityResult && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div>
                              Active zones:{' '}
                              <span key="totalCells">
                                {densityResult.stats.totalCells}
                              </span>{' '}
                            </div>
                            ·
                            <div>
                              CA Satellites:{' '}
                              <span key="closeApproachSatelliteCount">
                                {
                                  densityResult.stats
                                    .closeApproachSatelliteCount
                                }
                              </span>
                            </div>
                            {densityLoading && (
                              <Loader2 className="h-3 w-3 text-cyan-400 animate-spin" />
                            )}
                          </div>
                          {/* <div className="text-[11px] mt-1.5 text-gray-200">
                                Close approaches:{' '}
                                <span key="totalCandidatePairs">
                                  {densityResult.stats.totalCandidatePairs}
                                </span>
                              </div> */}
                          <div className="text-[11px] text-gray-400">
                            Showing{' '}
                            <span key="displayedCandidatePairs">
                              {densityResult.stats.displayedCandidatePairs}
                            </span>
                            /
                            <span key="totalCandidatePairs2">
                              {densityResult.stats.totalCandidatePairs}
                            </span>{' '}
                            pairs · Peak zone:{' '}
                            <span key="maxCellCount">
                              {densityResult.stats.maxCellCount}
                            </span>{' '}
                            sats
                          </div>
                        </div>
                      )}
                      {!densityLoading && densityError && (
                        <span className="text-red-400">{densityError}</span>
                      )}
                    </div>
                    {densityResult &&
                      densityResult.candidatePairs.length > 0 && (
                        <div className="mt-3 space-y-1 text-[10px] text-gray-300">
                          <div className="uppercase tracking-wider text-gray-400">
                            Top 50 Close Approaches
                          </div>
                          <div className="max-h-44 overflow-auto space-y-1 pr-1">
                            {densityResult.candidatePairs.map((pair) => {
                              const entryA = entries.find(
                                (e) => e.id === pair.idA
                              );
                              return (
                                <div
                                  key={`${pair.idA}-${pair.idB}`}
                                  onClick={() =>
                                    entryA && onFocusSatellite(entryA)
                                  }
                                  className="flex items-center justify-between rounded border cursor-pointer border-gray-700/60 px-2 py-1 hover:border-cyan-400/30 hover:bg-cyan-500/10 transition-colors"
                                >
                                  <div className="flex flex-col text-[11px] text-gray-200">
                                    <span>
                                      #{pair.idA} ↔ #{pair.idB}
                                    </span>
                                    <span className="text-[10px] text-gray-400">
                                      Alt {Math.round(pair.altitudeA)} /{' '}
                                      {Math.round(pair.altitudeB)} km
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span
                                      className={
                                        pair.distanceKm <= densityRadiusKm / 2
                                          ? 'text-red-300'
                                          : 'text-cyan-200'
                                      }
                                    >
                                      {formatDistance(pair.distanceKm)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </>
    </div>
  );
}

export default memo(RightPanel, (prev, next) => {
  return (
    prev.bandCount === next.bandCount &&
    prev.bandAvgAltKm === next.bandAvgAltKm &&
    prev.bandTrackLoading === next.bandTrackLoading &&
    prev.densityLoading === next.densityLoading &&
    prev.densityError === next.densityError &&
    prev.densityResult === next.densityResult &&
    prev.stats.leo === next.stats.leo &&
    prev.stats.meo === next.stats.meo &&
    prev.stats.geo === next.stats.geo &&
    prev.stats.debris === next.stats.debris &&
    prev.stats.total === next.stats.total &&
    prev.stats.filtered === next.stats.filtered &&
    prev.showReentry === next.showReentry &&
    prev.reentryRisks === next.reentryRisks &&
    prev.onFocusSatellite === next.onFocusSatellite
  );
});
