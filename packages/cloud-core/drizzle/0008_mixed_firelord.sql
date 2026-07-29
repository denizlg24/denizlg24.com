CREATE TYPE "public"."alert_aggregate" AS ENUM('last', 'avg', 'max', 'min');--> statement-breakpoint
CREATE TYPE "public"."alert_comparison" AS ENUM('gt', 'gte', 'lt', 'lte');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_state" AS ENUM('ok', 'firing');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_unit" AS ENUM('percent', 'bytes', 'bytes_per_second', 'count', 'celsius', 'ratio');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'tiering_orphaned' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'metric_rule' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'metric_rule_resolved' BEFORE 'test';--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"enabled" boolean DEFAULT true NOT NULL,
	"series" varchar(512) NOT NULL,
	"aggregate" "alert_aggregate" DEFAULT 'avg' NOT NULL,
	"window_seconds" integer DEFAULT 300 NOT NULL,
	"comparison" "alert_comparison" DEFAULT 'gt' NOT NULL,
	"threshold" double precision NOT NULL,
	"for_seconds" integer DEFAULT 0 NOT NULL,
	"severity" "activity_severity" DEFAULT 'warn' NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"unit" "alert_rule_unit" DEFAULT 'count' NOT NULL,
	"state" "alert_rule_state" DEFAULT 'ok' NOT NULL,
	"state_since" timestamp with time zone,
	"breaching_since" timestamp with time zone,
	"last_value" double precision,
	"last_evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_rules_enabled_idx" ON "alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "alert_rules_series_idx" ON "alert_rules" USING btree ("series");