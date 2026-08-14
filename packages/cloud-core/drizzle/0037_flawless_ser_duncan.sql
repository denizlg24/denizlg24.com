-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction but refuses to
-- let the new value be *used* in the same one, and drizzle's migrator runs every
-- pending migration in a single transaction — a separate file is not a separate
-- transaction. So nothing in this batch may name 'environment' as an enum
-- literal; 0038's CHECK constraints compare on ::text for that reason.
ALTER TYPE "public"."deploy_env_scope" ADD VALUE 'environment' BEFORE 'preview';--> statement-breakpoint
ALTER TYPE "public"."deployment_kind" ADD VALUE 'environment' BEFORE 'preview';
