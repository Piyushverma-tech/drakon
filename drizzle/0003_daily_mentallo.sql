CREATE TABLE "trend_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"norad_id" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reentry_tier" text NOT NULL,
	"decay_signal" text NOT NULL,
	"decay_confidence" double precision,
	"estimated_days_remaining" integer
);
--> statement-breakpoint
CREATE INDEX "idx_trend_snapshots_norad_captured" ON "trend_snapshots" USING btree ("norad_id","captured_at");