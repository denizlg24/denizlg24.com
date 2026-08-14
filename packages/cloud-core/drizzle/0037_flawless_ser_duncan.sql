-- Alone in this file on purpose. Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction but refuses to let the new value be *used* in the same
-- one, and the next migration's CHECK constraints compare against 'environment'
-- literally. Together in one file they fail with "unsafe use of new value of
-- enum type" — which reads as a schema problem rather than a transaction one.
ALTER TYPE "public"."deploy_env_scope" ADD VALUE 'environment' BEFORE 'preview';--> statement-breakpoint
ALTER TYPE "public"."deployment_kind" ADD VALUE 'environment' BEFORE 'preview';
