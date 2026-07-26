CREATE TYPE "public"."activity_actor_type" AS ENUM('user', 'api_key', 's3_credential', 'share', 'system', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."activity_category" AS ENUM('auth', 'storage', 's3', 'projects', 'database', 'ops', 'tasks', 'terminal', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."activity_severity" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('task_failed', 'task_recovered', 'backup_completed', 'backup_failed', 'disk_usage_high', 'disk_critical', 'memory_high', 'temperature_high', 'service_down', 'service_recovered', 'container_oom', 'container_crash_loop', 'api_error_rate', 'auth_failure_burst', 'tiering_moved', 'test');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "activity_category" NOT NULL,
	"severity" "activity_severity" DEFAULT 'info' NOT NULL,
	"action" varchar(128) NOT NULL,
	"actor_type" "activity_actor_type" DEFAULT 'system' NOT NULL,
	"actor_id" varchar(255),
	"actor_label" varchar(255),
	"method" varchar(10),
	"path" varchar(2048),
	"status_code" integer,
	"duration_ms" integer,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"target_type" varchar(64),
	"target_id" varchar(255),
	"message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(512) NOT NULL,
	"type" "notification_type" NOT NULL,
	"severity" "activity_severity" DEFAULT 'info' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"send_count" integer DEFAULT 0 NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"last_payload" jsonb,
	CONSTRAINT "notification_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE INDEX "activity_log_ts_brin_idx" ON "activity_log" USING brin ("ts");--> statement-breakpoint
CREATE INDEX "activity_log_category_ts_idx" ON "activity_log" USING btree ("category","ts");--> statement-breakpoint
CREATE INDEX "activity_log_severity_ts_idx" ON "activity_log" USING btree ("severity","ts");--> statement-breakpoint
CREATE INDEX "activity_log_action_ts_idx" ON "activity_log" USING btree ("action","ts");--> statement-breakpoint
CREATE INDEX "activity_log_actor_ts_idx" ON "activity_log" USING btree ("actor_id","ts");--> statement-breakpoint
CREATE INDEX "activity_log_status_ts_idx" ON "activity_log" USING btree ("status_code","ts");--> statement-breakpoint
CREATE INDEX "notification_events_type_idx" ON "notification_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_events_last_seen_at_idx" ON "notification_events" USING btree ("last_seen_at");