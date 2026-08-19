CREATE TABLE "user_custom_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"foodId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "user_custom_foods_user_food_unique" UNIQUE("userId","foodId")
);
--> statement-breakpoint
ALTER TABLE "user_custom_foods" ADD CONSTRAINT "user_custom_foods_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_custom_foods" ADD CONSTRAINT "user_custom_foods_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_custom_foods_user_created_idx" ON "user_custom_foods" USING btree ("userId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_custom_foods_food_id_idx" ON "user_custom_foods" USING btree ("foodId");
--> statement-breakpoint
INSERT INTO "user_custom_foods" ("userId", "foodId", "createdAt", "updatedAt")
SELECT "ownerUserId", "id", "createdAt", "updatedAt"
FROM "foods"
WHERE "source" = 'custom'
  AND "ownerUserId" IS NOT NULL
ON CONFLICT ("userId", "foodId") DO NOTHING;
