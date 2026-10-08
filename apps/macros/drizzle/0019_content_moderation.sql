CREATE TYPE "public"."food_report_reason" AS ENUM('offensive', 'spam', 'incorrect', 'personal_info', 'other');--> statement-breakpoint
CREATE TYPE "public"."food_report_status" AS ENUM('open', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TABLE "food_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"externalItemId" uuid NOT NULL,
	"barcode" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"removedAt" timestamp with time zone,
	"removedReason" text,
	"removedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporterUserId" text NOT NULL,
	"externalItemId" uuid NOT NULL,
	"reason" "food_report_reason" NOT NULL,
	"note" text,
	"status" "food_report_status" DEFAULT 'open' NOT NULL,
	"resolvedAt" timestamp with time zone,
	"resolvedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subjectType" text NOT NULL,
	"subjectId" text NOT NULL,
	"detail" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"blockedUserId" text NOT NULL,
	"viaItemId" uuid,
	"viaLabel" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."userId" <> "user_blocks"."blockedUserId")
);
--> statement-breakpoint
CREATE TABLE "user_restrictions" (
	"userId" text PRIMARY KEY NOT NULL,
	"sharingSuspendedAt" timestamp with time zone,
	"suspendedAt" timestamp with time zone,
	"reason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_contributions" ADD CONSTRAINT "food_contributions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_reports" ADD CONSTRAINT "food_reports_reporterUserId_user_id_fk" FOREIGN KEY ("reporterUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedUserId_user_id_fk" FOREIGN KEY ("blockedUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_contributions_item_unique" ON "food_contributions" USING btree ("externalItemId");--> statement-breakpoint
CREATE INDEX "food_contributions_user_created_idx" ON "food_contributions" USING btree ("userId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "food_contributions_created_idx" ON "food_contributions" USING btree ("createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "food_reports_reporter_item_unique" ON "food_reports" USING btree ("reporterUserId","externalItemId");--> statement-breakpoint
CREATE INDEX "food_reports_status_item_idx" ON "food_reports" USING btree ("status","externalItemId");--> statement-breakpoint
CREATE INDEX "food_reports_item_idx" ON "food_reports" USING btree ("externalItemId");--> statement-breakpoint
CREATE INDEX "moderation_events_created_idx" ON "moderation_events" USING btree ("createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_events_subject_idx" ON "moderation_events" USING btree ("subjectType","subjectId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_pair_unique" ON "user_blocks" USING btree ("userId","blockedUserId");