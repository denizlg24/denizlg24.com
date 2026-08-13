CREATE TYPE "public"."custom_hostname_ssl_method" AS ENUM('http', 'txt');--> statement-breakpoint
ALTER TABLE "deploy_domains" ADD COLUMN "ssl_validation_method" "custom_hostname_ssl_method";