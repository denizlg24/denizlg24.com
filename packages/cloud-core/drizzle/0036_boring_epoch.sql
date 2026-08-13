CREATE TABLE "preview_share_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deployment_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preview_share_grants" ADD CONSTRAINT "preview_share_grants_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_share_grants_deployment_idx" ON "preview_share_grants" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "preview_share_grants_expires_at_idx" ON "preview_share_grants" USING btree ("expires_at");