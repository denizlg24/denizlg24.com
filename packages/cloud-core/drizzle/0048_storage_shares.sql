-- Stateful share links (plan 021 §7.3). Legacy HMAC tokens keep verifying
-- without a row here.
CREATE TYPE "public"."share_kind" AS ENUM('file', 'folder');--> statement-breakpoint
CREATE TABLE "storage_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "share_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone,
	"password_hash" text,
	"allow_download" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "storage_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "storage_shares" ADD CONSTRAINT "storage_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_shares_owner_id_idx" ON "storage_shares" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "storage_shares_target_idx" ON "storage_shares" USING btree ("kind","target_id");