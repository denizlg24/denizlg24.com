CREATE TABLE "auth_tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"homepage_url" text,
	"privacy_url" text,
	"terms_url" text,
	"signup" text DEFAULT 'closed' NOT NULL,
	"mfa" text DEFAULT 'optional' NOT NULL,
	"require_verified_email" boolean DEFAULT true NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth_tenant_block" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tenant_block_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_tenant_member" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tenant_member_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "auth_oauth_resource" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "realm" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
-- Every account that exists before self-service sign-up was made by the owner.
UPDATE "auth_user" SET "realm" = 'cloud';--> statement-breakpoint
ALTER TABLE "auth_tenant" ADD CONSTRAINT "auth_tenant_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tenant_block" ADD CONSTRAINT "auth_tenant_block_tenant_id_auth_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."auth_tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tenant_block" ADD CONSTRAINT "auth_tenant_block_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tenant_block" ADD CONSTRAINT "auth_tenant_block_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tenant_member" ADD CONSTRAINT "auth_tenant_member_tenant_id_auth_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."auth_tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tenant_member" ADD CONSTRAINT "auth_tenant_member_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tenant_member_user_idx" ON "auth_tenant_member" USING btree ("user_id");