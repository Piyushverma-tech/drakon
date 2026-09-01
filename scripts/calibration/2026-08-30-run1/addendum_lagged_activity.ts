/**
 * Run 1 addendum (2026-08-31) — computes the actual production activity
 * feature (computeRecencyWeightedActivity, the real recency-weighted
 * exponential-decay predictor Stage 2 uses) at each TLE epoch, for
 * several candidate decay constants, instead of Run 1's unweighted
 * mean-ap-over-the-epoch-span predictor.
 *
 * Reuses lib/geomagneticIndex.ts's real exported function directly — not
 * a reimplementation — so this can't silently drift from what the
 * production multiplier actually computes. The function's own
 * `ageHours < 0` guard means passing the full real ap series as history
 * and evaluating at any past instant is safe: it cannot see "future" ap
 * samples relative to that instant (verified against
 * lib/geomagneticIndex.test.ts's "does not leak look-ahead" tests).
 *
 * Run from repo root:
 *   npx tsx scripts/calibration/2026-08-30-run1/addendum_lagged_activity.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import {
  computeRecencyWeightedActivity,
  type ThreeHourApObservation,
  type KpClass,
} from '../../../lib/geomagneticIndex';

const dir = __dirname;
const apCsv = fs.readFileSync(path.join(dir, 'real_ap_series.csv'), 'utf-8');
const rateCsv = fs.readFileSync(path.join(dir, 'tle_rates_with_ap.csv'), 'utf-8');

const apRows = Papa.parse(apCsv, { header: true, dynamicTyping: true })
  .data as Array<{ intervalStart: string; kpClass: string; ap: number }>;

const history: ThreeHourApObservation[] = apRows
  .filter((r) => r.intervalStart)
  .map((r) => ({
    intervalStart: r.intervalStart,
    kpClass: r.kpClass as KpClass,
    estimatedAp: r.ap,
    observedAt: r.intervalStart, // DGD has no finer resolution than the 3h bucket itself
  }));

const rateRows = Papa.parse(rateCsv, { header: true, dynamicTyping: true }).data as Array<
  Record<string, string | number>
>;

const CANDIDATE_TAUS = [6, 12, 18, 24];

const out: Record<string, unknown>[] = [];
for (const row of rateRows) {
  if (!row.epoch) continue;
  const epochMs = new Date(row.epoch as string).getTime();
  if (!Number.isFinite(epochMs)) continue;

  const record: Record<string, unknown> = { ...row };
  for (const tau of CANDIDATE_TAUS) {
    const activity = computeRecencyWeightedActivity(history, epochMs, tau);
    record[`activity_tau${tau}h`] = activity;
  }
  out.push(record);
}

const outCsv = Papa.unparse(out);
fs.writeFileSync(path.join(dir, 'tle_rates_with_lagged_activity.csv'), outCsv);
console.log(`Wrote ${out.length} rows with activity_tau{6,12,18,24}h to tle_rates_with_lagged_activity.csv`);
