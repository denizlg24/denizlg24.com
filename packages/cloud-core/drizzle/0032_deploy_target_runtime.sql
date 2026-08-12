CREATE TYPE "public"."deploy_runtime" AS ENUM('node', 'bun');--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'seconds';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'milliseconds';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'megahertz';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'rpm';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'volts';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'watts';--> statement-breakpoint
ALTER TYPE "public"."alert_rule_unit" ADD VALUE IF NOT EXISTS 'amps';--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "runtime" "deploy_runtime";--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "runtime_version" varchar(16);--> statement-breakpoint
UPDATE "deploy_targets" SET "runtime" = 'node', "runtime_version" = "node_version" WHERE "node_version" IS NOT NULL;
