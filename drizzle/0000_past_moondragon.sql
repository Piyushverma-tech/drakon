CREATE TABLE "tle_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"norad_id" integer NOT NULL,
	"epoch" timestamp with time zone NOT NULL,
	"bstar" double precision NOT NULL,
	"mean_motion" double precision NOT NULL,
	"mean_motion_dot" double precision NOT NULL,
	"eccentricity" double precision NOT NULL,
	"inclination" double precision NOT NULL,
	"perigee_km" double precision NOT NULL,
	"apogee_km" double precision NOT NULL,
	"tle_line1" text NOT NULL,
	"tle_line2" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tle_history_norad_epoch_unique" UNIQUE("norad_id","epoch")
);
--> statement-breakpoint
CREATE INDEX "idx_tle_history_norad_epoch" ON "tle_history" USING btree ("norad_id","epoch");--> statement-breakpoint
CREATE INDEX "idx_tle_history_ingested_at" ON "tle_history" USING btree ("ingested_at");