CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"foodId" uuid NOT NULL,
	"item" jsonb NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"servingQuantity" numeric(12, 4) NOT NULL,
	"servingUnit" text NOT NULL,
	"stockedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_items_user_food_unique" UNIQUE("userId","foodId"),
	CONSTRAINT "pantry_items_quantity_check" CHECK ("pantry_items"."quantity" >= 0),
	CONSTRAINT "pantry_items_serving_quantity_check" CHECK ("pantry_items"."servingQuantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;