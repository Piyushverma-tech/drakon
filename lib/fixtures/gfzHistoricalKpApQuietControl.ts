/**
 * Real, independently-sourced QUIET CONTROL period — same source and
 * provenance as lib/fixtures/gfzHistoricalKpAp.ts (CelesTrak's CSSI
 * Space Weather Data file, republishing GFZ Potsdam's official
 * definitive Kp/ap index; retrieved via st-bender/pyspaceweather's
 * bundled SW-All.txt, 2026-08-29).
 *
 * Required by GEOMAGNETIC_STORM_REENTRY_PLAN.md §17 Phase 1 ("The
 * dataset must include both geomagnetically active and quiet control
 * periods") and §17 Phase 7 (the quiet-window rejection test: a
 * candidate correction that creates artificial acceleration during
 * quiet windows must be rejected).
 *
 * Covers 2024-01-04 through 2024-01-17 UTC (112 three-hour intervals) —
 * selected programmatically as the quietest real 14-day window in the
 * 2024-2026 OBSERVED (not predicted) portion of the source file, subject
 * to being at least three months clear of the May 2024 Gannon storm (so
 * this is a genuine control period, not a storm-recovery tail). Mean
 * daily Ap = 4.0, max daily Ap = 6 (three-hourly max = 12, in two
 * intervals) across the window — the two ap=12 intervals sit slightly
 * above GEOMAG_ACTIVITY_THRESHOLD (9) and should register a small
 * nonzero correction; everything else should sit at exactly 1.0. This is
 * itself a useful edge case for the quiet-window rejection test (plan
 * §17 Phase 7) — a real quiet period is not perfectly flat, and the
 * multiplier should track that faithfully rather than being either
 * always exactly 1.0 or falsely elevated throughout.
 */

import type { GfzHistoricalKpApEntry } from './gfzHistoricalKpAp';

export const GFZ_HISTORICAL_KP_AP_QUIET_CONTROL_JAN_2024: GfzHistoricalKpApEntry[] = [
  { intervalStart: '2024-01-04T00:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-04T03:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-04T06:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-04T09:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-04T12:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-04T15:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-04T18:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-04T21:00:00.000Z', kpRawTenths: 27, kpNumeric: 2.7, officialAp: 12 },
  { intervalStart: '2024-01-05T00:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-05T03:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-05T06:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-05T09:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-05T12:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-05T15:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-05T18:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-05T21:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-06T00:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-06T03:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-06T06:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-06T09:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-06T12:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-06T15:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-06T18:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-06T21:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-07T00:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-07T03:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-07T06:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-07T09:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-07T12:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-07T15:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-07T18:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-07T21:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-08T00:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-08T03:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-08T06:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-08T09:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-08T12:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-08T15:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-08T18:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-08T21:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-09T00:00:00.000Z', kpRawTenths: 23, kpNumeric: 2.3, officialAp: 9 },
  { intervalStart: '2024-01-09T03:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-09T06:00:00.000Z', kpRawTenths: 23, kpNumeric: 2.3, officialAp: 9 },
  { intervalStart: '2024-01-09T09:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-09T12:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-09T15:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-09T18:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-09T21:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-10T00:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-10T03:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-10T06:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-10T09:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-10T12:00:00.000Z', kpRawTenths: 23, kpNumeric: 2.3, officialAp: 9 },
  { intervalStart: '2024-01-10T15:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-10T18:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-10T21:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-11T00:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-11T03:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-11T06:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-11T09:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-11T12:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-11T15:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-11T18:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-11T21:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-12T00:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-12T03:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-12T06:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-12T09:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-12T12:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-12T15:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-12T18:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-12T21:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-13T00:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-13T03:00:00.000Z', kpRawTenths: 0, kpNumeric: 0.0, officialAp: 0 },
  { intervalStart: '2024-01-13T06:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-13T09:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-13T12:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-13T15:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-13T18:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-13T21:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-14T00:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-14T03:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-14T06:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-14T09:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-14T12:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-14T15:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-14T18:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-14T21:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-15T00:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-15T03:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-15T06:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-15T09:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-15T12:00:00.000Z', kpRawTenths: 23, kpNumeric: 2.3, officialAp: 9 },
  { intervalStart: '2024-01-15T15:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-15T18:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-15T21:00:00.000Z', kpRawTenths: 17, kpNumeric: 1.7, officialAp: 6 },
  { intervalStart: '2024-01-16T00:00:00.000Z', kpRawTenths: 27, kpNumeric: 2.7, officialAp: 12 },
  { intervalStart: '2024-01-16T03:00:00.000Z', kpRawTenths: 20, kpNumeric: 2.0, officialAp: 7 },
  { intervalStart: '2024-01-16T06:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-16T09:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-16T12:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-16T15:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-16T18:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },
  { intervalStart: '2024-01-16T21:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-17T00:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-17T03:00:00.000Z', kpRawTenths: 3, kpNumeric: 0.3, officialAp: 2 },
  { intervalStart: '2024-01-17T06:00:00.000Z', kpRawTenths: 13, kpNumeric: 1.3, officialAp: 5 },
  { intervalStart: '2024-01-17T09:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-17T12:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-17T15:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-17T18:00:00.000Z', kpRawTenths: 7, kpNumeric: 0.7, officialAp: 3 },
  { intervalStart: '2024-01-17T21:00:00.000Z', kpRawTenths: 10, kpNumeric: 1.0, officialAp: 4 },

];
