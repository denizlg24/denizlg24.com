ALTER TABLE "deploy_targets" ALTER COLUMN "memory_limit_mb" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deploy_targets" ALTER COLUMN "memory_limit_mb" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "memory_reservation_mb" integer DEFAULT 256 NOT NULL;--> statement-breakpoint
-- The old `memory_limit_mb` was a hard cap with swap off, so it was provisioned
-- for each target's worst minute. That figure is the right reservation: it is
-- what the owner already decided the app needs.
UPDATE "deploy_targets"
SET "memory_reservation_mb" = "memory_limit_mb"
WHERE "memory_limit_mb" IS NOT NULL;--> statement-breakpoint
-- Then drop the explicit ceiling so every existing target adopts the derived
-- one. This only ever loosens: the ceiling becomes a multiple of what used to
-- be the kill threshold, so nothing that ran before can start failing here.
UPDATE "deploy_targets" SET "memory_limit_mb" = NULL;
