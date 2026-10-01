/**
 * Generalized version of Run 1's addendum_lagged_activity.ts -- same
 * reuse pattern (calls lib/geomagneticIndex.ts's real, exported
 * computeRecencyWeightedActivity() directly, not a reimplementation, so
 * this can't silently drift from what the production multiplier actually
 * computes), but parametrized by input/output path so it runs against
 * any window's rate file, not just Run 1's.
 *
 * The function's own `ageHours < 0` guard (verified in
 * lib/geomagneticIndex.test.ts's "no look-ahead bias" tests) makes it
 * safe to evaluate at any past instant against the full real ap series
 * without leaking future data into a lagged feature.
 *
 * Usage (from repo root):
 *   npx tsx scripts/calibration/shared/lagged_activity.ts <rates.csv> <ap_series.csv> <output.csv>
 */

import * as fs from 'fs';
import Papa from 'papaparse';
import { computeRecencyWeightedActivity, type ThreeHourApObservation, type KpClass } from '../../../lib/geomagneticIndex';

const [, , ratesArg, apArg, outputArg] = process.argv;
if (!ratesArg || !apArg || !outputArg) {
  console.error('Usage: lagged_activity.ts <rates.csv> <ap_series.csv> <output.csv>');
  process.exit(1);
}

const apCsv = fs.readFileSync(apArg, 'utf-8');
const rateCsv = fs.readFileSync(ratesArg, 'utf-8');

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
fs.writeFileSync(outputArg, outCsv);
console.log(`Wrote ${out.length} rows with activity_tau{6,12,18,24}h to ${outputArg}`);
