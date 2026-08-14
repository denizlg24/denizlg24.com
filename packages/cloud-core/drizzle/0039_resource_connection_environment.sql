-- Safe in one transaction only because nothing below names 'environment' as an
-- enum literal — see 0037. The column and the two indexes test environment_id
-- for NULL, never the scope, so the new value is added here and first used by
-- the application after the migration commits.
--
-- The plain unique constraint has to go: NULLs are distinct in Postgres, so
-- keeping it while adding environment_id to a second key would let two default
-- connections share a prefix. Two partial indexes split the rule instead.
ALTER TYPE "public"."resource_connection_scope" ADD VALUE 'environment';--> statement-breakpoint
ALTER TABLE "resource_connections" DROP CONSTRAINT "resource_connections_resource_project_prefix_key";--> statement-breakpoint
ALTER TABLE "resource_connections" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_connections" ADD CONSTRAINT "resource_connections_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_connections_resource_project_prefix_key" ON "resource_connections" USING btree ("resource_id","project_id","env_prefix") WHERE "resource_connections"."environment_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_connections_resource_project_prefix_env_key" ON "resource_connections" USING btree ("resource_id","project_id","env_prefix","environment_id") WHERE "resource_connections"."environment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_connections_environment_id_idx" ON "resource_connections" USING btree ("environment_id");