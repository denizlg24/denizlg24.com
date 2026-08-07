ALTER TABLE "deployments" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "github_check_run_id" bigint;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "github_deployment_id" bigint;--> statement-breakpoint
CREATE INDEX "deployments_pr_idx" ON "deployments" USING btree ("target_id","pr_number");