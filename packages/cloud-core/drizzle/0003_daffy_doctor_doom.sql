ALTER TYPE "public"."task_type" ADD VALUE 'tiering_pass';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'metrics_rollup';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'alert_evaluation';--> statement-breakpoint
CREATE TABLE "metrics_samples" (
	"ts" timestamp with time zone NOT NULL,
	"kind" varchar(64) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" double precision NOT NULL,
	"interval_seconds" smallint DEFAULT 30 NOT NULL,
	CONSTRAINT "metrics_samples_pkey" PRIMARY KEY("ts","kind","key","interval_seconds")
);
--> statement-breakpoint
ALTER TABLE "task_runs" ADD COLUMN "failure_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "metrics_samples_ts_brin_idx" ON "metrics_samples" USING brin ("ts");--> statement-breakpoint
CREATE INDEX "metrics_samples_series_ts_idx" ON "metrics_samples" USING btree ("kind","key","interval_seconds","ts");