CREATE TABLE "python_compute_shadow_object_deltas" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"norad_id" integer NOT NULL,
	"request_id" text NOT NULL,
	"duration_ms" double precision NOT NULL,
	"python_failure_type" text,
	"difference_count" integer NOT NULL,
	"differences" jsonb NOT NULL,
	"ts_tier" text NOT NULL,
	"python_tier" text
);
--> statement-breakpoint
CREATE TABLE "python_compute_shadow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_model_id" text NOT NULL,
	"expected_model_version" text NOT NULL,
	"catalog_size" integer NOT NULL,
	"eligible_count" integer NOT NULL,
	"sampled_count" integer NOT NULL,
	"success_count" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"value_mismatch_count" integer NOT NULL,
	"failure_count" integer NOT NULL,
	"failures_by_type" jsonb NOT NULL,
	"duration_ms_p50" double precision,
	"duration_ms_p95" double precision,
	"duration_ms_p99" double precision,
	"sample_rate" double precision NOT NULL,
	"max_sample_size" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_python_compute_shadow_deltas_run_id" ON "python_compute_shadow_object_deltas" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_python_compute_shadow_deltas_norad_id" ON "python_compute_shadow_object_deltas" USING btree ("norad_id");--> statement-breakpoint
CREATE INDEX "idx_python_compute_shadow_runs_generated_at" ON "python_compute_shadow_runs" USING btree ("generated_at");


