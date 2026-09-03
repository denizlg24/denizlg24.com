ALTER TABLE "deployments" ADD COLUMN "image_digest" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "resolved_builder" varchar(16);--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_resolved_builder" CHECK (resolved_builder IS NULL OR resolved_builder IN ('dockerfile', 'nixpacks'));--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_recovery_digest" CHECK (image_digest IS NULL OR (image_digest ~ '^sha256:[0-9a-f]{64}$' AND image_tag IS NOT NULL AND image_tag LIKE ('%@' || image_digest)));