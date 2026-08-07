CREATE TYPE "public"."deploy_builder" AS ENUM('auto', 'dockerfile', 'nixpacks');--> statement-breakpoint
CREATE TYPE "public"."deploy_domain_mode" AS ENUM('zone_record', 'custom_hostname');--> statement-breakpoint
CREATE TYPE "public"."deploy_domain_status" AS ENUM('pending', 'verifying', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deploy_env_scope" AS ENUM('all', 'production', 'preview');--> statement-breakpoint
CREATE TYPE "public"."deploy_env_source" AS ENUM('literal', 'binding', 'template');--> statement-breakpoint
CREATE TYPE "public"."deploy_trigger" AS ENUM('git', 'manual', 'rollback', 'api');--> statement-breakpoint
CREATE TYPE "public"."deployment_kind" AS ENUM('production', 'preview');--> statement-breakpoint
CREATE TYPE "public"."deployment_phase" AS ENUM('cloning', 'building', 'starting', 'health-check', 'routing');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'deploying', 'ready', 'failed', 'cancelled', 'superseded', 'interrupted');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'tiering_quarantined' BEFORE 'metric_rule';--> statement-breakpoint
CREATE TABLE "deploy_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"mode" "deploy_domain_mode" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"zone_id" varchar(64),
	"dns_record_id" varchar(64),
	"custom_hostname_id" varchar(64),
	"status" "deploy_domain_status" DEFAULT 'pending' NOT NULL,
	"verification" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "deploy_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"source" "deploy_env_source" DEFAULT 'literal' NOT NULL,
	"encrypted_value" text,
	"value_iv" text,
	"value_auth_tag" text,
	"reference" varchar(255),
	"template" text,
	"scope" "deploy_env_scope" DEFAULT 'all' NOT NULL,
	"build_time" boolean DEFAULT false NOT NULL,
	"run_time" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_env_vars_source_shape" CHECK (
    (source = 'literal'  AND encrypted_value IS NOT NULL AND reference IS NULL AND template IS NULL) OR
    (source = 'binding'  AND reference       IS NOT NULL AND encrypted_value IS NULL AND template IS NULL) OR
    (source = 'template' AND template        IS NOT NULL AND encrypted_value IS NULL AND reference IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "deploy_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"repo_owner" varchar(128) NOT NULL,
	"repo_name" varchar(128) NOT NULL,
	"production_branch" varchar(128) DEFAULT 'main' NOT NULL,
	"github_installation_id" bigint,
	"root_directory" text,
	"builder" "deploy_builder" DEFAULT 'auto' NOT NULL,
	"dockerfile_path" text,
	"install_command" text,
	"build_command" text,
	"start_command" text,
	"health_path" text DEFAULT '/' NOT NULL,
	"memory_limit_mb" integer DEFAULT 512 NOT NULL,
	"cpu_limit" numeric(4, 2) DEFAULT '1.0' NOT NULL,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"preview_deploys" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" "deployment_kind" NOT NULL,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"phase" "deployment_phase",
	"git_ref" varchar(255) NOT NULL,
	"git_sha" varchar(40) NOT NULL,
	"git_message" text,
	"hostname" varchar(255) NOT NULL,
	"dns_record_id" varchar(64),
	"port" integer,
	"image_tag" text,
	"container_id" varchar(64),
	"image_size_bytes" bigint,
	"build_duration_ms" integer,
	"error" text,
	"triggered_by" "deploy_trigger" NOT NULL,
	"created_by" uuid,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
ALTER TABLE "deploy_domains" ADD CONSTRAINT "deploy_domains_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD CONSTRAINT "deploy_env_vars_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_targets" ADD CONSTRAINT "deploy_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_domains_primary_per_target" ON "deploy_domains" USING btree ("target_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "deploy_domains_target_idx" ON "deploy_domains" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_env_vars_target_key_scope_key" ON "deploy_env_vars" USING btree ("target_id","key","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_targets_project_name_key" ON "deploy_targets" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "deploy_targets_repo_idx" ON "deploy_targets" USING btree ("repo_owner","repo_name");--> statement-breakpoint
CREATE INDEX "deployments_target_idx" ON "deployments" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_created_at_idx" ON "deployments" USING btree ("created_at");