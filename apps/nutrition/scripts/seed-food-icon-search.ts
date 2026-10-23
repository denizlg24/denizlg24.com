import { Pool } from "pg";
import { buildIconCatalog } from "./food-icons/catalog";
import { FoodIconSearch, type IconSearchDocument } from "./food-icons/search";

const pool = new Pool({ connectionString: Bun.env.DATABASE_URL });
try {
  const catalog = new Map(
    (await buildIconCatalog("config/food-icons/rules.json")).map((entry) => [
      entry.key,
      entry.terms,
    ]),
  );
  const { rows } = await pool.query<{
    key: string;
    name: string;
    foodGroup: string;
  }>(
    'select key, name, food_group as "foodGroup" from food_icons order by key',
  );
  const documents: IconSearchDocument[] = rows.map((row) => ({
    ...row,
    id: row.key,
    aliases: catalog.get(row.key) ?? [],
  }));
  const search = new FoodIconSearch();
  const digest = await search.seed(documents);
  console.log(
    JSON.stringify({ index: search.index, icons: documents.length, digest }),
  );
  const queries = [
    "Greek yogurt",
    "oat milk",
    "almond drink",
    "chia seeds",
    "tofu",
    "apple",
    "chicken",
    "chocolate truffles",
    "banana bread",
    "random unrecognizable product",
  ];
  const results = await search.searchMany(queries);
  for (let i = 0; i < queries.length; i++)
    console.log(JSON.stringify({ query: queries[i], hits: results[i] }));
} finally {
  await pool.end();
}
