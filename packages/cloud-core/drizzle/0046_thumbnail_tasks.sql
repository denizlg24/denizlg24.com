-- The two thumbnail passes. Only the enum grows here: the rows are seeded by
-- `seedDefaultOpsTasks` at boot, which is a separate transaction from this one,
-- so the values may be used as soon as the API starts.
ALTER TYPE "public"."task_type" ADD VALUE 'thumbnail_backfill';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'thumbnail_gc';
