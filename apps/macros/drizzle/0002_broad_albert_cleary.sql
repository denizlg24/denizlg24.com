CREATE TABLE "user_day_rollover_states" (
	"userId" text PRIMARY KEY NOT NULL,
	"lastFinalizedLogDate" date,
	"lastRunAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD COLUMN "timezoneAtLog" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "weigh_ins" ADD COLUMN "timezoneAtLog" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_day_rollover_states" ADD CONSTRAINT "user_day_rollover_states_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;