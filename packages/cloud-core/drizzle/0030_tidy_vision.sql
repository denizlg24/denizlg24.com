CREATE TYPE "public"."resource_connection_scope" AS ENUM('production', 'preview', 'both');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('postgres', 'mongodb', 'redis', 's3', 'meilisearch');--> statement-breakpoint
CREATE TABLE "resource_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scopes" "resource_connection_scope" DEFAULT 'both' NOT NULL,
	"env_prefix" varchar(48) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_connections_resource_project_prefix_key" UNIQUE("resource_id","project_id","env_prefix")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"engine" varchar(64) DEFAULT 'pi-cloud' NOT NULL,
	"namespace_id" uuid,
	"db_name" varchar(255),
	"username" varchar(255),
	"encrypted_password" text,
	"iv" text,
	"auth_tag" text,
	"bucket" varchar(255),
	"meili_api_key_uid" text,
	"meili_api_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resources_kind_shape" CHECK (
        CASE "resources"."kind"
          WHEN 's3' THEN "resources"."bucket" IS NOT NULL
          WHEN 'meilisearch' THEN "resources"."meili_api_key" IS NOT NULL AND "resources"."meili_api_key_uid" IS NOT NULL
          ELSE "resources"."db_name" IS NOT NULL
            AND "resources"."username" IS NOT NULL
            AND "resources"."encrypted_password" IS NOT NULL
            AND "resources"."iv" IS NOT NULL
            AND "resources"."auth_tag" IS NOT NULL
        END
      )
);
--> statement-breakpoint
ALTER TABLE "resource_connections" ADD CONSTRAINT "resource_connections_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_connections" ADD CONSTRAINT "resource_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_namespace_id_fkey" FOREIGN KEY ("namespace_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_connections_project_id_idx" ON "resource_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "resource_connections_resource_id_idx" ON "resource_connections" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_kind_name_unique" ON "resources" USING btree ("kind","name") WHERE "resources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "resources_kind_idx" ON "resources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "resources_namespace_id_idx" ON "resources" USING btree ("namespace_id");