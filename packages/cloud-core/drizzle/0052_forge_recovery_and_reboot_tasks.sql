-- The recovery-image republish and the weekly Forge reboot. Only the enum grows
-- here: the rows are seeded by `seedDefaultOpsTasks` at boot, a separate
-- transaction, so the values may be used as soon as the API starts.
ALTER TYPE "public"."task_type" ADD VALUE 'forge_recovery_publish';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'forge_reboot';
