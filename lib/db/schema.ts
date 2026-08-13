import {
  pgTable,
  integer,
  doublePrecision,
  real,
  smallint,
  text,
  timestamp,
  boolean,
  unique,
  index,
  serial,
} from 'drizzle-orm/pg-core';

// ─── tle_history ──────────────────────────────────────────────────────────────
// Partitioned monthly by epoch (see migration SQL).
// This Drizzle definition describes the parent table structure only.

export const tleHistory = pgTable(
  'tle_history',
  {
    noradId: integer('norad_id').notNull(),
    epoch: timestamp('epoch', { withTimezone: true }).notNull(),

    // Core decay signals
    bstar: real('bstar').notNull(),
    meanMotion: real('mean_motion').notNull(),
    meanMotionDot: real('mean_motion_dot').notNull(),
    eccentricity: real('eccentricity').notNull(),

    // Orbital geometry — derived at ingest, never recomputed
    inclination: real('inclination').notNull(),
    raan: real('raan').notNull(), // right ascension of ascending node, deg
    argPerigee: real('arg_perigee').notNull(), // argument of perigee, deg
    meanAnomaly: real('mean_anomaly').notNull(), // mean anomaly at epoch, deg
    perigeeKm: real('perigee_km').notNull(),
    apogeeKm: real('apogee_km').notNull(),
    semiMajorAxisKm: real('semi_major_axis_km').notNull(),
    // Provenance
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceGroup: text('source_group').notNull(),
  },
  (table) => [
    // Single index covering both the uniqueness enforcement (via UNIQUE constraint
    // in migration SQL) and the primary time-series access pattern.
    // The UNIQUE constraint is declared in raw SQL so onConflictDoNothing()
    // has a named target.
    index('idx_tle_history_norad_epoch').on(table.noradId, table.epoch),

    // Trend worker sweep: "objects ingested in last 2 hours"
    index('idx_tle_history_ingested_at').on(table.ingestedAt),
  ]
);

// ─── tle_archive ──────────────────────────────────────────────────────────────
// Raw TLE lines. Write-once, point-lookup only.

export const tleArchive = pgTable(
  'tle_archive',
  {
    noradId: integer('norad_id').notNull(),
    epoch: timestamp('epoch', { withTimezone: true }).notNull(),
    name: text('name').notNull(),
    tleLine1: text('tle_line1').notNull(),
    tleLine2: text('tle_line2').notNull(),
    storedAt: timestamp('stored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('tle_archive_norad_epoch_unique').on(table.noradId, table.epoch),
  ]
);

// ─── object_trends ────────────────────────────────────────────────────────────
// Derived cache. One row per NORAD ID. Owned entirely by the trend worker.
// trendVersion allows safe algorithm changes without a migration:
// bump CURRENT_TREND_VERSION in the worker, stale rows get recomputed.

export const objectTrends = pgTable(
  'object_trends',
  {
    noradId: integer('norad_id').primaryKey(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Cache validity — bump worker version to invalidate all rows
    trendVersion: smallint('trend_version').notNull().default(0),

    // Data coverage — distinguishes "300 epochs/30 days" from "8 epochs/1 day"
    epochsAvailable: integer('epochs_available').notNull().default(0),
    historyDaysAvailable: doublePrecision('history_days_available')
      .notNull()
      .default(0),

    // ── BSTAR signals ───────────────────────────────────────────────────────
    bstarLatest: doublePrecision('bstar_latest'),
    bstarSlope7d: doublePrecision('bstar_slope_7d'),
    bstarSlope14d: doublePrecision('bstar_slope_14d'),
    bstarSlope30d: doublePrecision('bstar_slope_30d'),
    bstarMean14d: doublePrecision('bstar_mean_14d'),
    bstarStddev14d: doublePrecision('bstar_stddev_14d'),
    bstarRsq14d: doublePrecision('bstar_rsq_14d'),

    // ── Altitude signals ────────────────────────────────────────────────────
    perigeeLatest: doublePrecision('perigee_latest'),
    perigeeSlope7d: doublePrecision('perigee_slope_7d'),
    perigeeSlope14d: doublePrecision('perigee_slope_14d'),
    perigeeSlope30d: doublePrecision('perigee_slope_30d'),

    apogeeLatest: doublePrecision('apogee_latest'),
    apogeeSlope14d: doublePrecision('apogee_slope_14d'),

    smaLatest: doublePrecision('sma_latest'),
    smaSlope7d: doublePrecision('sma_slope_7d'),
    smaSlope14d: doublePrecision('sma_slope_14d'),

    // ── N-dot signals ───────────────────────────────────────────────────────
    meanMotionDotLatest: doublePrecision('mean_motion_dot_latest'),
    meanMotionDotMean14d: doublePrecision('mean_motion_dot_mean_14d'),

    // ── Derived classification ───────────────────────────────────────────────
    // 'decaying' | 'stable' | 'maneuvering' | 'tumbling' | 'insufficient_data'
    decaySignal: text('decay_signal').notNull().default('insufficient_data'),
    maneuverLikelihood: doublePrecision('maneuver_likelihood'),
    decayConfidence: doublePrecision('decay_confidence'),
    bstarSignalStrength: doublePrecision('bstar_signal_strength'),
    ndotSignalStrength: doublePrecision('ndot_signal_strength'),
    altitudeSignalStrength: doublePrecision('altitude_signal_strength'),
    consensusRequired: text('consensus_required'),
    consensusMet: boolean('consensus_met'),

    // ── Re-entry estimate ───────────────────────────────────────────────────
    estimatedDaysRemaining: integer('estimated_days_remaining'),
    estimatedReentryAt: timestamp('estimated_reentry_at', {
      withTimezone: true,
    }),
    reentryTier: text('reentry_tier').notNull().default('stable'),

    // ── Object metadata ─────────────────────────────────────────────────────
    objectType: text('object_type'), // 'debris' | 'rocket_body' | 'payload' | 'unknown'
    isDebris: boolean('is_debris').notNull().default(false),
  },
  (table) => [
    // Dashboard: "show all non-stable objects sorted by confidence"
    // Composite covers the filter (tier != 'stable') and the sort (confidence DESC)
    index('idx_reentry_tier_confidence').on(
      table.reentryTier,
      table.decayConfidence
    ),

    // Cache invalidation sweep: "find all rows with old trendVersion"
    index('idx_object_trends_version').on(table.trendVersion),
  ]
);

// ─── trend_jobs ───────────────────────────────────────────────────────────────
// Active jobs only. Done rows are deleted immediately after processing.
// Table stays small — at steady state it holds only the backlog.

export const trendJobs = pgTable(
  'trend_jobs',
  {
    id: serial('id').primaryKey(),
    noradId: integer('norad_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'failed'
    // No 'done' status — done rows are deleted, not marked
    errorMessage: text('error_message'),
    retryCount: smallint('retry_count').notNull().default(0),
  },
  (table) => [
    // Worker poll query: pending jobs in arrival order
    index('idx_trend_jobs_status_created').on(table.status, table.createdAt),

    // Prevent duplicate pending jobs for the same object.
    // Enforced as a partial unique index in migration SQL:
    // UNIQUE (norad_id) WHERE status = 'pending'
    // Drizzle can't express partial unique indexes yet, so declared in raw SQL.
    index('idx_trend_jobs_norad_id').on(table.noradId),
  ]
);

export const trendSnapshots = pgTable(
  'trend_snapshots',
  {
    id: serial('id').primaryKey(),
    noradId: integer('norad_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reentryTier: text('reentry_tier').notNull(),
    decaySignal: text('decay_signal').notNull(),
    decayConfidence: doublePrecision('decay_confidence'),
    estimatedDaysRemaining: integer('estimated_days_remaining'),
  },
  (table) => [
    // Track record query: latest-first snapshots for one object
    index('idx_trend_snapshots_norad_captured').on(
      table.noradId,
      table.capturedAt
    ),
  ]
);
