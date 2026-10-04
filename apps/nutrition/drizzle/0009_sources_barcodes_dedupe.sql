CREATE TABLE "item_barcodes" (
	"barcode" text PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_portions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" numeric(12, 3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "food_group" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "popularity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cluster_key" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "concept_name" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "icon_source" text DEFAULT 'rule' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_portions" ADD CONSTRAINT "item_portions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_barcodes_item_id_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_portions_item_label_idx" ON "item_portions" USING btree ("item_id","label");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_merged_into_items_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_merged_into_idx" ON "items" USING btree ("merged_into") WHERE "items"."merged_into" is not null;--> statement-breakpoint
CREATE INDEX "items_cluster_key_idx" ON "items" USING btree ("cluster_key");