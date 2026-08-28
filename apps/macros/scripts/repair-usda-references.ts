import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/connection";
import { foods } from "@/db/schema";
import { searchNutritionFoods } from "@/lib/foods/source";

/**
 * The nutrition API rebuilt its USDA catalogue from Foundation + SR Legacy.
 * Every USDA food was replaced, so both its id and its barcode changed:
 * `usda:foundation:<fdcId>` and `usda:legacy:<fdcId>` became
 * `usda:<ndbNumber>`. Locally cached foods still point at the old ids and now
 * resolve to 404, which breaks snapshot refresh for anything logged from them.
 *
 * Historical snapshots and log entries are deliberately left alone: they are
 * immutable records of what was logged at the time. Only the pointer used to
 * fetch future snapshots is repaired.
 *
 * USDA descriptions survive the rebuild unchanged, so the replacement row is
 * found by exact name. Foods whose name no longer resolves are reported rather
 * than guessed at.
 *
 * Run with --dry-run first.
 */

const dryRun = process.argv.includes("--dry-run");

async function resolveByName(name: string) {
  const results = await searchNutritionFoods({ q: name, limit: 10 });
  return results.find((item) => item.name === name);
}

async function main() {
  const candidates = await db
    .select({
      id: foods.id,
      name: foods.name,
      barcode: foods.barcode,
      externalItemId: foods.externalItemId,
    })
    .from(foods)
    .where(
      and(
        eq(foods.source, "deniz_nutrition"),
        isNotNull(foods.externalItemId),
        // Only the old two-segment form; rebuilt rows are usda:<ndbNumber>.
        sql`${foods.barcode} like 'usda:%:%'`,
      ),
    );

  console.log(`Legacy USDA references: ${candidates.length}`);

  // Foundation and SR Legacy entries for the same food merged into a single
  // item upstream, so two locally cached foods can now resolve to one id.
  // foods_source_external_item_id_unique forbids that, and merging local rows
  // would rewrite history that log entries point at, so collisions are
  // reported and left alone.
  const claimed = new Set(
    (
      await db
        .select({ externalItemId: foods.externalItemId })
        .from(foods)
        .where(
          and(
            eq(foods.source, "deniz_nutrition"),
            isNotNull(foods.externalItemId),
          ),
        )
    )
      .map((row) => row.externalItemId)
      .filter((id): id is string => id !== null),
  );

  let repaired = 0;
  const unresolved: string[] = [];
  const collided: string[] = [];

  for (const candidate of candidates) {
    const match = await resolveByName(candidate.name);

    if (!match) {
      unresolved.push(`${candidate.barcode} ${candidate.name}`);
      continue;
    }

    if (claimed.has(match.id)) {
      collided.push(`${candidate.barcode} ${candidate.name}`);
      continue;
    }

    if (!dryRun) {
      await db
        .update(foods)
        .set({
          externalItemId: match.id,
          barcode: match.barcode ?? candidate.barcode,
          updatedAt: new Date(),
        })
        .where(eq(foods.id, candidate.id));
    }

    claimed.delete(candidate.externalItemId ?? "");
    claimed.add(match.id);
    repaired += 1;
  }

  console.log(`${dryRun ? "Would repair" : "Repaired"}: ${repaired}`);
  console.log(`Merged upstream, left alone: ${collided.length}`);
  for (const row of collided.slice(0, 20)) {
    console.log(`  ${row}`);
  }
  console.log(`Unresolved: ${unresolved.length}`);
  for (const row of unresolved.slice(0, 20)) {
    console.log(`  ${row}`);
  }
}

await main();
