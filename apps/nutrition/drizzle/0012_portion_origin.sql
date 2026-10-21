ALTER TABLE "item_portions" ADD COLUMN "origin" text DEFAULT 'source' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_portions" ADD COLUMN "donor_item_id" uuid;--> statement-breakpoint
ALTER TABLE "item_portions" ADD CONSTRAINT "item_portions_donor_item_id_items_id_fk" FOREIGN KEY ("donor_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_portions_origin_idx" ON "item_portions" USING btree ("origin");--> statement-breakpoint
ALTER TABLE "item_portions" ADD CONSTRAINT "item_portions_origin_check" CHECK ("item_portions"."origin" in ('source', 'concept', 'llm'));