CREATE TABLE "geomagnetic_shadow_object_deltas" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"norad_id" integer NOT NULL,
	"solar_only_days" integer,
	"solar_only_tier" text NOT NULL,
	"corrected_days" integer,
	"corrected_tier" text NOT NULL,
	"days_delta" integer,
	"tier_changed" boolean NOT NULL,
	"solar_only_tip_agreement" text,
	"corrected_tip_agreement" text
);
--> statement-breakpoint
CREATE TABLE "geomagnetic_shadow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"replay_label" text,
	"observed_at" timestamp with time zone,
	"kp_class" text,
	"estimated_ap" integer,
	"activity" double precision,
	"freshness" text NOT NULL,
	"model_version" smallint NOT NULL,
	"solar_flux_multiplier" double precision NOT NULL,
	"geomagnetic_multiplier" double precision NOT NULL,
	"combined_multiplier" double precision NOT NULL,
	"objects_evaluated" integer NOT NULL,
	"objects_with_tier_change" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_geomagnetic_shadow_deltas_run_id" ON "geomagnetic_shadow_object_deltas" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_geomagnetic_shadow_deltas_norad_id" ON "geomagnetic_shadow_object_deltas" USING btree ("norad_id");--> statement-breakpoint
CREATE INDEX "idx_geomagnetic_shadow_runs_generated_at" ON "geomagnetic_shadow_runs" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "idx_geomagnetic_shadow_runs_source" ON "geomagnetic_shadow_runs" USING btree ("source");