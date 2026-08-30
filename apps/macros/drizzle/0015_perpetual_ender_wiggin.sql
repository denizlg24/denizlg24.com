CREATE TABLE "food_log_day_notes" (
	"userId" text NOT NULL,
	"logDate" date NOT NULL,
	"note" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_log_day_notes_userId_logDate_pk" PRIMARY KEY("userId","logDate")
);
--> statement-breakpoint
ALTER TABLE "food_log_day_notes" ADD CONSTRAINT "food_log_day_notes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;