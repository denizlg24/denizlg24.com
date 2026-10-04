CREATE TABLE "food_icons" (
	"key" text PRIMARY KEY NOT NULL,
	"food_group" text NOT NULL,
	"media_type" text DEFAULT 'image/png' NOT NULL,
	"image_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "food_icons" ("key", "food_group", "media_type", "image_base64")
VALUES (
	'other-001',
	'other',
	'image/png',
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2HFwgAAAABJRU5ErkJggg=='
);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "icon_key" text DEFAULT 'other-001' NOT NULL;--> statement-breakpoint
CREATE INDEX "food_icons_food_group_idx" ON "food_icons" USING btree ("food_group");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_icon_key_food_icons_key_fk" FOREIGN KEY ("icon_key") REFERENCES "public"."food_icons"("key") ON DELETE no action ON UPDATE no action;
