-- Notification types for the dashboard phone app: Forge deployment failures and
-- auth security events. Only the enum grows; rows using them are written at
-- runtime by the dispatcher, a separate transaction.
ALTER TYPE "public"."notification_type" ADD VALUE 'forge_deploy_failed' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'auth_sign_in' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'auth_credential_changed' BEFORE 'test';