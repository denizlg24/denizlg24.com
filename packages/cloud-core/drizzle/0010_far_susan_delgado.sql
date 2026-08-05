CREATE TABLE "smb_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"principal" varchar(64) NOT NULL,
	"device_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_authenticated_at" timestamp with time zone,
	"last_authenticated_from" varchar(64),
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(255),
	"failed_auth_count" integer DEFAULT 0 NOT NULL,
	"last_failed_auth_at" timestamp with time zone,
	CONSTRAINT "smb_credentials_principal_unique" UNIQUE("principal")
);
--> statement-breakpoint
ALTER TABLE "smb_credentials" ADD CONSTRAINT "smb_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "smb_credentials_user_id_idx" ON "smb_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "smb_credentials_revoked_at_idx" ON "smb_credentials" USING btree ("revoked_at");