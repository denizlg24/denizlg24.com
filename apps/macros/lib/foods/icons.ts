import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/connection";
import { foods, userCustomFoods } from "@/db/schema";
import type { ExternalFoodSummary } from "@/lib/foods/contracts";
import { getNutritionFoodSummary } from "@/lib/foods/source";

const ICON_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
const ICON_REFRESH_BATCH = 10;

/**
 * A source food's stored row is a copy, and the log and history read their
 * icon from it. Anything the source says now overwrites it, so an icon
 * changed at the source reaches every surface the next time it is read.
 */
export async function syncStoredIcons(
  summaries: readonly Pick<ExternalFoodSummary, "id" | "iconKey">[],
): Promise<void> {
  if (summaries.length === 0) return;
  const values = sql.join(
    summaries.map((summary) => sql`(${summary.id}::uuid, ${summary.iconKey})`),
    sql`, `,
  );
  await db.execute(sql`
    update ${foods}
    set "iconKey" = source.icon, "updatedAt" = now()
    from (values ${values}) as source(id, icon)
    where ${foods.source} = 'deniz_nutrition'
      and ${foods.externalItemId} = source.id
      and ${foods.iconKey} is distinct from source.icon
  `);
}

/**
 * Re-reads the source for stored rows nobody has refreshed in a day. Meant
 * to run after a response is sent, a few rows at a time.
 */
export async function refreshStaleIcons(
  localFoodIds: readonly string[],
): Promise<void> {
  if (localFoodIds.length === 0) return;
  const stale = await db
    .select({ externalItemId: foods.externalItemId })
    .from(foods)
    .where(
      and(
        inArray(foods.id, [...localFoodIds]),
        eq(foods.source, "deniz_nutrition"),
        lt(foods.updatedAt, new Date(Date.now() - ICON_REFRESH_AGE_MS)),
      ),
    )
    .orderBy(asc(foods.updatedAt))
    .limit(ICON_REFRESH_BATCH);

  const summaries = await Promise.all(
    stale.map(({ externalItemId }) =>
      externalItemId
        ? getNutritionFoodSummary(externalItemId).catch(() => null)
        : null,
    ),
  );
  const found = summaries.filter((summary) => summary !== null);
  await syncStoredIcons(found);
  // Rows the source still agrees with are marked checked too, or they would
  // be re-read on every request.
  const checked = stale.flatMap(({ externalItemId }) =>
    externalItemId ? [externalItemId] : [],
  );
  if (checked.length > 0) {
    await db
      .update(foods)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(foods.source, "deniz_nutrition"),
          inArray(foods.externalItemId, checked),
        ),
      );
  }
}

/**
 * Editing a food the user did not create makes them their own copy, and the
 * copy keeps the barcode. Entries logged before the edit still point at the
 * original, so this is how the log and history learn the icon the user
 * picked for it.
 */
export async function ownIconsByBarcode(
  userId: string,
  barcodes: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(barcodes.filter((code) => code !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ barcode: foods.barcode, iconKey: foods.iconKey })
    .from(userCustomFoods)
    .innerJoin(foods, eq(foods.id, userCustomFoods.foodId))
    .where(
      and(
        eq(userCustomFoods.userId, userId),
        isNull(userCustomFoods.deletedAt),
        eq(foods.ownerUserId, userId),
        inArray(foods.barcode, wanted),
      ),
    );
  return new Map(
    rows.flatMap((row) => (row.barcode ? [[row.barcode, row.iconKey]] : [])),
  );
}
