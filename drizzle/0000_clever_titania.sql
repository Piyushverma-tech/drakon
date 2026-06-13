CREATE TABLE tle_history (
  norad_id             INTEGER NOT NULL,
  epoch                TIMESTAMPTZ NOT NULL,
  bstar                DOUBLE PRECISION NOT NULL,
  mean_motion          DOUBLE PRECISION NOT NULL,
  mean_motion_dot      DOUBLE PRECISION NOT NULL,
  eccentricity         DOUBLE PRECISION NOT NULL,
  inclination          DOUBLE PRECISION NOT NULL,
  raan                 DOUBLE PRECISION NOT NULL,
  arg_perigee          DOUBLE PRECISION NOT NULL,
  mean_anomaly         DOUBLE PRECISION NOT NULL,
  perigee_km           DOUBLE PRECISION NOT NULL,
  apogee_km            DOUBLE PRECISION NOT NULL,
  semi_major_axis_km   DOUBLE PRECISION NOT NULL,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_group         TEXT NOT NULL,

  CONSTRAINT tle_history_norad_epoch_unique UNIQUE (norad_id, epoch)
) PARTITION BY RANGE (epoch);

CREATE INDEX idx_tle_history_norad_epoch
  ON tle_history (norad_id, epoch DESC);

CREATE INDEX idx_tle_history_ingested_at
  ON tle_history (ingested_at DESC);

CREATE TABLE tle_history_2026_06
  PARTITION OF tle_history
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE tle_history_2026_07
  PARTITION OF tle_history
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE tle_history_2026_08
  PARTITION OF tle_history
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE tle_history_default
  PARTITION OF tle_history DEFAULT;

CREATE TABLE tle_archive (
  norad_id     INTEGER NOT NULL,
  epoch        TIMESTAMPTZ NOT NULL,
  name         TEXT NOT NULL,
  tle_line1    TEXT NOT NULL,
  tle_line2    TEXT NOT NULL,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tle_archive_norad_epoch_unique UNIQUE (norad_id, epoch)
);

CREATE TABLE object_trends (
  norad_id                   INTEGER PRIMARY KEY,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trend_version              SMALLINT NOT NULL DEFAULT 0,
  epochs_available           INTEGER NOT NULL DEFAULT 0,
  history_days_available     DOUBLE PRECISION NOT NULL DEFAULT 0,
  bstar_latest               DOUBLE PRECISION,
  bstar_slope_7d             DOUBLE PRECISION,
  bstar_slope_14d            DOUBLE PRECISION,
  bstar_slope_30d            DOUBLE PRECISION,
  bstar_mean_14d             DOUBLE PRECISION,
  bstar_stddev_14d           DOUBLE PRECISION,
  bstar_rsq_14d              DOUBLE PRECISION,
  perigee_latest             DOUBLE PRECISION,
  perigee_slope_7d           DOUBLE PRECISION,
  perigee_slope_14d          DOUBLE PRECISION,
  perigee_slope_30d          DOUBLE PRECISION,
  apogee_latest              DOUBLE PRECISION,
  apogee_slope_14d           DOUBLE PRECISION,
  sma_latest                 DOUBLE PRECISION,
  sma_slope_14d              DOUBLE PRECISION,
  mean_motion_dot_latest     DOUBLE PRECISION,
  mean_motion_dot_mean_14d   DOUBLE PRECISION,
  decay_signal               TEXT NOT NULL DEFAULT 'insufficient_data',
  maneuver_likelihood        DOUBLE PRECISION,
  decay_confidence           DOUBLE PRECISION,
  estimated_days_remaining   INTEGER,
  estimated_reentry_at       TIMESTAMPTZ,
  reentry_tier               TEXT NOT NULL DEFAULT 'stable',
  object_type                TEXT,
  is_debris                  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_reentry_tier_confidence
  ON object_trends (reentry_tier, decay_confidence);

CREATE INDEX idx_object_trends_version
  ON object_trends (trend_version);

CREATE INDEX idx_object_trends_active
  ON object_trends (reentry_tier, decay_confidence DESC)
  WHERE reentry_tier != 'stable';

CREATE TABLE trend_jobs (
  id             SERIAL PRIMARY KEY,
  norad_id       INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  retry_count    SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_trend_jobs_status_created
  ON trend_jobs (status, created_at);

CREATE INDEX idx_trend_jobs_norad_id
  ON trend_jobs (norad_id);

CREATE UNIQUE INDEX idx_trend_jobs_pending_norad
  ON trend_jobs (norad_id)
  WHERE status = 'pending';
