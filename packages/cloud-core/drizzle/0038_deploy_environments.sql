CREATE TYPE "public"."deploy_branch_match_type" AS ENUM('exact', 'glob');--> statement-breakpoint
CREATE TABLE "deploy_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"dns_record_id" varchar(64),
	"memory_reservation_mb" integer,
	"memory_limit_mb" integer,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_environments_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "deploy_branch_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"match_type" "deploy_branch_match_type" DEFAULT 'exact' NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "deploy_env_vars_target_key_scope_key";--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "deploy_branch_rules" ADD CONSTRAINT "deploy_branch_rules_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_branch_rules" ADD CONSTRAINT "deploy_branch_rules_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_branch_rules_target_pattern_key" ON "deploy_branch_rules" USING btree ("target_id","match_type","pattern");--> statement-breakpoint
CREATE INDEX "deploy_branch_rules_target_priority_idx" ON "deploy_branch_rules" USING btree ("target_id","priority");--> statement-breakpoint
CREATE INDEX "deploy_branch_rules_environment_idx" ON "deploy_branch_rules" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_environments_target_name_key" ON "deploy_environments" USING btree ("target_id","name");--> statement-breakpoint
CREATE INDEX "deploy_environments_target_idx" ON "deploy_environments" USING btree ("target_id");--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD CONSTRAINT "deploy_env_vars_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_environment_idx" ON "deployments" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_env_vars_target_key_scope_key" ON "deploy_env_vars" USING btree ("target_id","key","scope",coalesce("environment_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD CONSTRAINT "deploy_env_vars_environment_shape" CHECK ((scope::text = 'environment') = (environment_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_shape" CHECK ((kind::text = 'environment') = (environment_id IS NOT NULL));
