/**
 * Converts NOAA SWPC's "Daily Geomagnetic Data" product (Estimated
 * Planetary Kp column) into a real ap series, using this repo's own
 * production normalizeKpClass()/kpToAp() from lib/geomagneticIndex.ts --
 * not a re-implementation -- so Run 1's analysis is guaranteed to use
 * the exact same Kp->ap conversion the production code uses.
 *
 * Input: dgd.txt -- the raw NOAA product, saved verbatim. Source:
 * https://services.swpc.noaa.gov/text/daily-geomagnetic-indices.txt
 * ("Last 30 Days Daily Geomagnetic Data", issued 1230 UT 30 Aug 2026).
 * Only the "Estimated Planetary" column (the last 8 whitespace-separated
 * tokens per row) is used; the Fredericksburg/College K-index columns
 * are NOAA's ground-station-specific indices, not what this repo models.
 *
 * Run from the repo root: npx tsx scripts/calibration/2026-08-30-run1/convert_dgd_to_ap.ts
 * Output: real_ap_series.csv (intervalStart, kpDecimal, kpClass, ap)
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeKpClass, kpToAp } from '../../../lib/geomagneticIndex';

const inputPath = path.join(__dirname, 'dgd.txt');
const outputPath = path.join(__dirname, 'real_ap_series.csv');

const raw = fs.readFileSync(inputPath, 'utf-8').trim().split('\n');

type Row = { intervalStart: string; kpDecimal: number; kpClass: string; ap: number };
const rows: Row[] = [];

for (const line of raw) {
  const tokens = line.trim().split(/\s+/);
  const yy = tokens[0];
  const mm = tokens[1];
  const dd = tokens[2];
  const planetaryKp = tokens.slice(-8); // last 8 tokens = Estimated Planetary Kp, one per 3h interval

  for (let i = 0; i < 8; i++) {
    const kpDecimal = parseFloat(planetaryKp[i]);
    if (kpDecimal < 0) continue; // -1.00 = missing / interval hasn't occurred yet

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

console.log(`Parsed ${rows.length} real NOAA DGD intervals`);
fs.writeFileSync(
  outputPath,
  'intervalStart,kpDecimal,kpClass,ap\n' +
    rows.map((r) => `${r.intervalStart},${r.kpDecimal},${r.kpClass},${r.ap}`).join('\n')
);
console.log(`Written to ${outputPath}`);
