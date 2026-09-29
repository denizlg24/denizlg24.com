CREATE TYPE "public"."distribution_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."push_environment" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TABLE "distribution_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"udid" text NOT NULL,
	"note" text,
	"status" "distribution_request_status" DEFAULT 'pending' NOT NULL,
	"appleDeviceId" text,
	"decidedAt" timestamp with time zone,
	"registeredAt" timestamp with time zone,
	"installableAt" timestamp with time zone,
	"notifiedAt" timestamp with time zone,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"userId" text PRIMARY KEY NOT NULL,
	"weeklySummary" boolean DEFAULT true NOT NULL,
	"streakNudge" boolean DEFAULT true NOT NULL,
	"streakNudgeHour" integer DEFAULT 20 NOT NULL,
	"lastWeeklySummaryOn" date,
	"lastStreakNudgeOn" date,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_hour_range" CHECK ("notification_preferences"."streakNudgeHour" between 0 and 23)
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"environment" "push_environment" NOT NULL,
	"bundleId" text NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"disabledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "distribution_requests_udid_unique" ON "distribution_requests" USING btree ("udid");--> statement-breakpoint
CREATE INDEX "distribution_requests_status_idx" ON "distribution_requests" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("userId");