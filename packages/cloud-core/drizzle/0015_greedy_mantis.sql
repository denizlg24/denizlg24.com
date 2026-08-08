ALTER TYPE "public"."notification_type" ADD VALUE 'forge_disk_low' BEFORE 'metric_rule';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'forge_gc';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'domain_verification';