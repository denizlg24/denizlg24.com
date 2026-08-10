CREATE TYPE "public"."deploy_domain_origin" AS ENUM('generated', 'manual');--> statement-breakpoint
ALTER TABLE "deploy_domains" ADD COLUMN "origin" "deploy_domain_origin" DEFAULT 'manual' NOT NULL;