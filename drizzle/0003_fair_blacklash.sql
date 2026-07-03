ALTER TABLE "object_trends" ADD COLUMN IF NOT EXISTS "bstar_signal_strength" double precision;--> statement-breakpoint
ALTER TABLE "object_trends" ADD COLUMN IF NOT EXISTS "ndot_signal_strength" double precision;--> statement-breakpoint
ALTER TABLE "object_trends" ADD COLUMN IF NOT EXISTS "altitude_signal_strength" double precision;--> statement-breakpoint
ALTER TABLE "object_trends" ADD COLUMN IF NOT EXISTS "consensus_required" text;--> statement-breakpoint
ALTER TABLE "object_trends" ADD COLUMN IF NOT EXISTS "consensus_met" boolean;
