-- Exact queries that produced tle_raw.csv for Run 1 (2026-08-30).
-- Window narrowed from an initial 15-day/perigee<500km pull (378,219 rows,
-- 45MB, 4-5min) down to 8 days/perigee<350km/daily-dedup after a sanity
-- check showed the wider pull was impractical (DB egress/time).

-- Sanity check (run first): confirmed 3,993 rows / 610 objects before
-- running the full pull below.
SELECT COUNT(*) AS row_count, COUNT(DISTINCT norad_id) AS object_count
FROM (
  SELECT DISTINCT ON (norad_id, date_trunc('day', epoch))
    norad_id, epoch
  FROM tle_history
  WHERE epoch >= '2026-08-22T00:00:00Z'
    AND epoch <  '2026-08-30T00:00:00Z'
    AND perigee_km < 350
  ORDER BY norad_id, date_trunc('day', epoch), epoch DESC
) sized;

-- The actual pull (-> tle_raw.csv). One row per (object, UTC day): the
-- latest epoch that day, matching the day-level grain object_trends'
-- own perigee_slope_7d/14d already use.
SELECT DISTINCT ON (norad_id, date_trunc('day', epoch))
  norad_id,
  epoch,
  bstar,
  mean_motion,
  mean_motion_dot,
  eccentricity,
  perigee_km,
  apogee_km,
  semi_major_axis_km,
  source_group
FROM tle_history
WHERE epoch >= '2026-08-22T00:00:00Z'
  AND epoch <  '2026-08-30T00:00:00Z'
  AND perigee_km < 350
ORDER BY norad_id, date_trunc('day', epoch), epoch DESC;
