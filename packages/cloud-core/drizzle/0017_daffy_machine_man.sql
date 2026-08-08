ALTER TABLE "deploy_targets" ADD COLUMN "envoy_project_id" uuid;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "envoy_passphrase" text;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "envoy_passphrase_iv" text;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD COLUMN "envoy_passphrase_auth_tag" text;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD CONSTRAINT "deploy_targets_envoy_link_shape" CHECK (
    (envoy_project_id IS NULL AND envoy_passphrase IS NULL) OR
    (envoy_project_id IS NOT NULL AND envoy_passphrase IS NOT NULL
     AND envoy_passphrase_iv IS NOT NULL AND envoy_passphrase_auth_tag IS NOT NULL)
  );