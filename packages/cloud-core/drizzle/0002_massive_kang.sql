CREATE TABLE "s3_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"access_key_id" varchar(64) NOT NULL,
	"secret_access_key_hash" varchar(64) NOT NULL,
	"encrypted_secret_access_key" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"label" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "s3_credentials_access_key_id_key" UNIQUE("access_key_id")
);
--> statement-breakpoint
ALTER TABLE "s3_credentials" ADD CONSTRAINT "s3_credentials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "s3_credentials_project_id_idx" ON "s3_credentials" USING btree ("project_id");