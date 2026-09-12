CREATE TABLE "shopping_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"foodId" uuid,
	"iconKey" text,
	"checked" boolean DEFAULT false NOT NULL,
	"checkedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_items_label_present_check" CHECK (length(btrim("shopping_list_items"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "iconKey" text;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_foodId_foods_id_fk" FOREIGN KEY ("foodId") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_list_items_user_position_idx" ON "shopping_list_items" USING btree ("userId","position");