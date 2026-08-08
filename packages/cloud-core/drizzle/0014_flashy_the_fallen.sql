CREATE TABLE "deploy_github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_login" varchar(128) NOT NULL,
	"account_type" varchar(32) NOT NULL,
	"repository_selection" varchar(16) NOT NULL,
	"repositories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deploy_domains" ADD COLUMN "retired_at" timestamp with time zone;