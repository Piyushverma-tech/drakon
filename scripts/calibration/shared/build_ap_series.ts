/**
 * Generalized version of Run 1's convert_dgd_to_ap.ts -- same logic
 * (NOAA DGD "Estimated Planetary" Kp -> ap via this repo's own
 * normalizeKpClass()/kpToAp(), not a reimplementation), but parametrized
 * by input/output path instead of hardcoded to Run 1's dgd.txt, so the
 * same script serves every window instead of being copy-pasted per run.
 *
 * Usage (from repo root):
 *   npx tsx scripts/calibration/shared/build_ap_series.ts <input.txt> <output.csv>
 *
 * Input: raw NOAA SWPC "Daily Geomagnetic Data" product, saved verbatim.
 * Source: https://services.swpc.noaa.gov/text/daily-geomagnetic-indices.txt
 * Only the last 8 whitespace-separated tokens per row (Estimated Planetary
 * Kp, one per 3h interval) are used -- the Fredericksburg/College
 * ground-station K-index columns are not what this repo models.
 */

import * as fs from 'fs';
import { normalizeKpClass, kpToAp } from '../../../lib/geomagneticIndex';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('Usage: build_ap_series.ts <input.txt> <output.csv>');
  process.exit(1);
}

const raw = fs.readFileSync(inputArg, 'utf-8').trim().split('\n');

type Row = { intervalStart: string; kpDecimal: number; kpClass: string; ap: number };
const rows: Row[] = [];

for (const line of raw) {
  const tokens = line.trim().split(/\s+/);
  const yy = tokens[0];
  const mm = tokens[1];
  const dd = tokens[2];
  // Skip non-data lines (headers, comments, blank).
  if (!/^\d{4}$/.test(yy) || !/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd)) continue;

  const planetaryKp = tokens.slice(-8); // last 8 tokens = Estimated Planetary Kp

  for (let i = 0; i < 8; i++) {
    const kpDecimal = parseFloat(planetaryKp[i]);
    if (!Number.isFinite(kpDecimal) || kpDecimal < 0) continue; // -1.00 = missing/future

    const hour = i * 3;
    const intervalStart = `${yy}-${mm}-${dd}T${String(hour).padStart(2, '0')}:00:00.000Z`;

    const kpClass = normalizeKpClass(kpDecimal);
    if (!kpClass) {
      console.error(`FAILED to normalize kpDecimal=${kpDecimal} at ${intervalStart}`);
      continue;
    }
    rows.push({ intervalStart, kpDecimal, kpClass, ap: kpToAp(kpClass) });
  }
}

console.log(`Parsed ${rows.length} real NOAA DGD intervals from ${inputArg}`);
fs.writeFileSync(
  outputArg,
  'intervalStart,kpDecimal,kpClass,ap\n' +
    rows.map((r) => `${r.intervalStart},${r.kpDecimal},${r.kpClass},${r.ap}`).join('\n')
);
console.log(`Written to ${outputArg}`);
