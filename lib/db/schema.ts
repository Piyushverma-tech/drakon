import {
  pgTable,
  bigserial,
  integer,
  doublePrecision,
  text,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

export const tleHistory = pgTable(
  'tle_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    noradId: integer('norad_id').notNull(),
    epoch: timestamp('epoch', { withTimezone: true }).notNull(),
    bstar: doublePrecision('bstar').notNull(),
    meanMotion: doublePrecision('mean_motion').notNull(),
    meanMotionDot: doublePrecision('mean_motion_dot').notNull(),
    eccentricity: doublePrecision('eccentricity').notNull(),
    inclination: doublePrecision('inclination').notNull(),
    perigeeKm: doublePrecision('perigee_km').notNull(),
    apogeeKm: doublePrecision('apogee_km').notNull(),
    tleLine1: text('tle_line1').notNull(),
    tleLine2: text('tle_line2').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('tle_history_norad_epoch_unique').on(table.noradId, table.epoch),
    index('idx_tle_history_norad_epoch').on(table.noradId, table.epoch),
    index('idx_tle_history_ingested_at').on(table.ingestedAt),
  ]
);
