ALTER TABLE "python_compute_shadow_runs" ADD COLUMN "catalog_load_ms" double precision;--> statement-breakpoint
ALTER TABLE "python_compute_shadow_runs" ADD COLUMN "python_compute_ms" double precision;--> statement-breakpoint
ALTER TABLE "python_compute_shadow_runs" ADD COLUMN "persistence_ms" double precision;--> statement-breakpoint
ALTER TABLE "python_compute_shadow_runs" ADD COLUMN "total_route_ms" double precision;