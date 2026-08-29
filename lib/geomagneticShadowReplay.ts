/**
 * Repeatable replay path for Stage 2 shadow mode
 * (GEOMAGNETIC_STORM_REENTRY_PLAN.md §21). Runs the exact same
 * evaluateGeomagneticShadow() pipeline used for live scheduled runs, but
 * against a historical Kp/ap scenario instead of live Redis state — e.g.
 * "what would today's catalog look like under the May 2024 Gannon storm."
 *
 * Still isolated from production: buildReplayGeomagneticState() (in
 * geomagneticIndex.ts) touches no Redis, and evaluateGeomagneticShadow()
 * writes nothing. The only I/O in this file's callers is the current
 * catalog read (entries/trends/tip, the same inputs a live run needs) and
 * the persistence call in geomagneticShadowStore.ts — never anything in
 * the production risk path.
 */

import {
  buildReplayGeomagneticState,
  normalizeKpClass,
  type ThreeHourApObservation,
} from './geomagneticIndex';
import {
  evaluateGeomagneticShadow,
  type GeomagneticShadowSummary,
} from './geomagneticShadow';
import {
  GFZ_HISTORICAL_KP_AP_MAY_2024,
  type GfzHistoricalKpApEntry,
} from './fixtures/gfzHistoricalKpAp';
import type { ObjectTrend, TipPrediction, TleEntry } from './types';

export type ReplayScenario = {
  /** Short, stable identifier persisted as geomagnetic_shadow_runs.replay_label. */
  label: string;
  history: ThreeHourApObservation[];
  /** The historical instant to replay as-of — only observations at or before this count (see buildReplayGeomagneticState). */
  asOfMs: number;
};

/**
 * Build a ReplayScenario from the real GFZ/CelesTrak historical fixture
 * (lib/fixtures/gfzHistoricalKpAp.ts). Defaults to replaying as of the
 * end of the recorded week; pass an earlier asOfMs to replay an
 * in-progress point of the storm instead (e.g. its actual peak) rather
 * than its fully-resolved end state.
 */
export function buildReplayScenarioFromGfzFixture(
  label: string,
  entries: GfzHistoricalKpApEntry[] = GFZ_HISTORICAL_KP_AP_MAY_2024,
  asOfMs?: number
): ReplayScenario {
  if (entries.length === 0) {
    throw new Error('buildReplayScenarioFromGfzFixture: entries must not be empty');
  }

  const history: ThreeHourApObservation[] = entries.map((entry) => {
    const kpClass = normalizeKpClass(entry.kpNumeric);
    if (!kpClass) {
      throw new Error(
        `buildReplayScenarioFromGfzFixture: kpNumeric ${entry.kpNumeric} at ${entry.intervalStart} did not normalize`
      );
    }
    return {
      intervalStart: entry.intervalStart,
      kpClass,
      // Use the fixture's own officially published ap directly rather
      // than re-deriving via kpToAp() — this is ground truth, not
      // DRAKON's estimate, even though the two agree exactly (verified
      // in geomagneticIndex.historicalValidation.test.ts).
      estimatedAp: entry.officialAp,
      // The fixture has no finer-grained timestamp than the interval
      // itself, so treat the reading as observed at the interval start.
      observedAt: entry.intervalStart,
    };
  });

  const resolvedAsOfMs =
    asOfMs ?? new Date(entries[entries.length - 1].intervalStart).getTime();

  return { label, history, asOfMs: resolvedAsOfMs };
}

/**
 * Run one replay: builds the historical GeomagneticState as-of the
 * scenario's instant, then evaluates it against the CURRENT catalog
 * (there is no historical TLE snapshot to replay the catalog itself
 * against — see the isolation note above). `nowMs` is the real wall-clock
 * time the replay was executed, used only for
 * GeomagneticShadowSummary.generatedAt; it is intentionally NOT the same
 * as the historical instant being simulated, which shows up as
 * observedAt instead. This separation is what lets a persisted replay
 * record answer both "when did we run this" and "what moment in history
 * does it simulate" without conflating the two.
 */
export function runGeomagneticShadowReplay(
  scenario: ReplayScenario,
  entries: TleEntry[],
  objectTrendsById: Map<number, ObjectTrend> | undefined,
  solarFluxMultiplier: number,
  tipByNoradId?: Map<number, TipPrediction>,
  nowMs: number = Date.now()
): GeomagneticShadowSummary {
  const geomagneticState = buildReplayGeomagneticState(
    scenario.history,
    scenario.asOfMs
  );

  return evaluateGeomagneticShadow(
    entries,
    objectTrendsById,
    solarFluxMultiplier,
    geomagneticState,
    tipByNoradId,
    nowMs
  );
}
