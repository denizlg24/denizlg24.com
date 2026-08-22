ALTER TABLE "foods" ADD COLUMN "iconKey" text DEFAULT 'other-001' NOT NULL;--> statement-breakpoint
UPDATE "foods"
SET "iconKey" = latest."iconKey"
FROM (
	SELECT DISTINCT ON ("foodId")
		"foodId",
		"rawSummary"->>'iconKey' AS "iconKey"
	FROM "food_nutrition_snapshots"
	WHERE "rawSummary"->>'iconKey' IS NOT NULL
	ORDER BY "foodId", "fetchedAt" DESC
) AS latest
WHERE "foods"."id" = latest."foodId";
