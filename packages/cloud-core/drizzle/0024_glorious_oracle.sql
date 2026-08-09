ALTER TABLE "deployments" ADD COLUMN "memory_reservation_mb" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "memory_ceiling_mb" integer;--> statement-breakpoint
-- A deployment owns the runtime values it was admitted with. Backfill older
-- rows from their target; migration 0023 already translated the old hard cap
-- into the reservation and cleared the target's ceiling override.
UPDATE "deployments" AS "deployment"
SET
  "memory_reservation_mb" = "target"."memory_reservation_mb",
  "memory_ceiling_mb" = LEAST("target"."memory_reservation_mb" * 4, 32768)
FROM "deploy_targets" AS "target"
WHERE "deployment"."target_id" = "target"."id";--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "memory_reservation_mb" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "memory_ceiling_mb" SET NOT NULL;
