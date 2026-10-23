import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import {
  type IconSearchHit,
  normalizeIconQuery,
  resolveIconFallback,
  selectIconSearchHit,
} from "../src/modules/food-icons/matching";
import {
  type Candidate,
  classifyBatch,
  systemPrompt,
} from "./classify-foods-llm";
import { buildIconCatalog, renderCatalog } from "./food-icons/catalog";
import { FoodIconSearch } from "./food-icons/search";

const option = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};
const dryRun = Bun.argv.includes("--dry-run");
const llmFallback = Bun.argv.includes("--llm-fallback");
const refreshLlm = Bun.argv.includes("--refresh-llm");
const unresolvedOnly = Bun.argv.includes("--unresolved-only");
const limit = Number(option("--limit", "0"));
const batchSize = Number(option("--batch-size", "2000"));
const cachePath = resolve(
  option("--cache", "../../.impeccable/food-icons/search-cache.sqlite"),
);
const reportPath = resolve(
  option("--report", "../../.impeccable/food-icons/meilisearch-report.json"),
);
const backupPath = option("--backup", "");
if (!dryRun && !backupPath)
  throw new Error("--backup is required before applying food icon assignments");
if (
  !Number.isInteger(batchSize) ||
  batchSize < 1 ||
  !Number.isInteger(limit) ||
  limit < 0
)
  throw new Error("Invalid batch size or limit");

interface Food extends Candidate {
  conceptName: string | null;
  iconKey: string;
  iconSource: string;
}
interface Decision {
  food: Food;
  query: string;
  iconKey: string;
  iconSource: string;
  method:
    | "meilisearch"
    | "existing-llm"
    | "existing-specific"
    | "llm"
    | "unresolved";
}

await mkdir(dirname(cachePath), { recursive: true });
const cache = new Database(cachePath, { create: true });
cache.exec(
  "pragma journal_mode = WAL; create table if not exists search_results (version text, query text, hits text not null, primary key(version, query)); create table if not exists llm_results (version text, query text, icon_key text not null, primary key(version, query));",
);
const cachedSearch = cache.query<{ hits: string }, [string, string]>(
  "select hits from search_results where version = ? and query = ?",
);
const saveSearch = cache.query(
  "insert or replace into search_results (version, query, hits) values (?, ?, ?)",
);
const cachedLlm = cache.query<{ icon_key: string }, [string, string]>(
  "select icon_key from llm_results where version = ? and query = ?",
);
const saveLlm = cache.query(
  "insert or replace into llm_results (version, query, icon_key) values (?, ?, ?)",
);
const pool = new Pool({ connectionString: Bun.env.DATABASE_URL, max: 2 });
const backup = backupPath
  ? await open(resolve(backupPath), "wx", 0o600)
  : undefined;
const report = {
  scanned: 0,
  meilisearch: 0,
  existingLlm: 0,
  existingSpecific: 0,
  llm: 0,
  unresolved: 0,
  changedIcons: 0,
  changedRows: 0,
  written: 0,
  queriedNames: 0,
  llmCalls: 0,
  samples: [] as Array<{
    name: string;
    query: string;
    previous: string;
    proposed: string;
    method: string;
  }>,
  iconCounts: {} as Record<string, number>,
};

try {
  const catalog = await buildIconCatalog("config/food-icons/rules.json");
  const rows = await pool.query<{ key: string; name: string }>(
    "select key, name from food_icons order by key",
  );
  if (rows.rows.some((row) => !row.name.trim()))
    throw new Error("Run icons:import and icons:index before matching");
  const validKeys = new Set(rows.rows.map((row) => row.key));
  const version = createHash("sha256")
    .update(
      JSON.stringify({
        names: rows.rows,
        catalog,
        policy: "strict-all-whole-words-0.97-gap0.02-v2",
      }),
    )
    .digest("hex");
  const search = new FoodIconSearch();
  const system = systemPrompt(renderCatalog(catalog));
  let cursor = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    const size = limit
      ? Math.min(batchSize, limit - report.scanned)
      : batchSize;
    if (size <= 0) break;
    const { rows: foods } = await pool.query<Food>(
      `select id, name, name_en as "nameEn", concept_name as "conceptName", brand, food_group as "foodGroup", source, icon_key as "iconKey", icon_source as "iconSource" from items where merged_into is null and not quarantined and (${unresolvedOnly ? "icon_key = 'other-001' or icon_source not in ('llm', 'meilisearch')" : "true"}) and id > $1 order by id limit $2`,
      [cursor, size],
    );
    if (!foods.length) break;
    const queryFor = (food: Food) =>
      normalizeIconQuery(food.conceptName || food.nameEn || food.name);
    const queries = [...new Set(foods.map(queryFor).filter(Boolean))];
    const results = new Map<string, IconSearchHit[]>();
    const missing: string[] = [];
    for (const query of queries) {
      const cached = cachedSearch.get(version, query);
      if (cached)
        results.set(query, JSON.parse(cached.hits) as IconSearchHit[]);
      else missing.push(query);
    }
    for (let offset = 0; offset < missing.length; offset += 400) {
      const requests: string[][] = [];
      for (let i = offset; i < Math.min(offset + 400, missing.length); i += 100)
        requests.push(missing.slice(i, Math.min(i + 100, offset + 400)));
      const responses = await Promise.all(
        requests.map((request) => search.searchMany(request)),
      );
      cache.transaction(() => {
        for (const [i, request] of requests.entries())
          for (const [j, query] of request.entries()) {
            const hits = responses[i]?.[j];
            if (!hits)
              throw new Error("Meilisearch omitted an icon search result");
            results.set(query, hits);
            saveSearch.run(version, query, JSON.stringify(hits));
          }
      })();
      report.queriedNames += requests.reduce(
        (sum, request) => sum + request.length,
        0,
      );
    }

    const decisions: Decision[] = foods.map((food) => {
      const query = queryFor(food);
      const hit = selectIconSearchHit(
        query,
        results.get(query) ?? [],
        food.iconKey,
      );
      if (hit && validKeys.has(hit.key))
        return {
          food,
          query,
          iconKey: hit.key,
          iconSource: "meilisearch",
          method: "meilisearch",
        };
      // A previous model's valid specific answer is a reusable fallback,
      // reached only AFTER the new deterministic search was checked.
      if (
        !refreshLlm &&
        food.iconSource === "llm" &&
        food.iconKey !== "other-001" &&
        validKeys.has(food.iconKey)
      )
        return {
          food,
          query,
          iconKey: food.iconKey,
          iconSource: food.iconSource,
          method: "existing-llm",
        };
      const previous = cachedLlm.get(version, query);
      if (previous && validKeys.has(previous.icon_key))
        return {
          food,
          query,
          ...resolveIconFallback(
            food.iconKey,
            food.iconSource,
            previous.icon_key,
          ),
        };
      return {
        food,
        query,
        iconKey: food.iconKey,
        iconSource: food.iconSource,
        method: "unresolved",
      };
    });
    if (llmFallback) {
      const pending = [
        ...new Map(
          decisions
            .filter((decision) => decision.method === "unresolved")
            .map((decision) => [decision.query, decision]),
        ).values(),
      ];
      for (let offset = 0; offset < pending.length; offset += 640) {
        const chunks = Array.from({ length: 8 }, (_, index) =>
          pending.slice(
            offset + index * 80,
            Math.min(offset + (index + 1) * 80, offset + 640),
          ),
        ).filter((chunk) => chunk.length);
        await Promise.all(
          chunks.map(async (chunk) => {
            const assignments = await classifyBatch(
              system,
              chunk.map((decision) => decision.food),
              validKeys,
            );
            report.llmCalls++;
            // Retry only omitted answers, never the successfully classified foods.
            const omitted = chunk.filter(
              (decision) => !assignments.has(decision.food.id),
            );
            if (omitted.length) {
              const retried = await classifyBatch(
                system,
                omitted.map((decision) => decision.food),
                validKeys,
              );
              report.llmCalls++;
              for (const [id, assignment] of retried)
                assignments.set(id, assignment);
            }
            cache.transaction(() => {
              for (const decision of chunk) {
                const assignment = assignments.get(decision.food.id);
                if (assignment)
                  saveLlm.run(version, decision.query, assignment.iconKey);
              }
            })();
          }),
        );
      }
      for (const decision of decisions)
        if (decision.method === "unresolved") {
          const assignment = cachedLlm.get(version, decision.query);
          if (assignment && validKeys.has(assignment.icon_key))
            Object.assign(
              decision,
              resolveIconFallback(
                decision.food.iconKey,
                decision.food.iconSource,
                assignment.icon_key,
              ),
            );
        }
    }

    const changes = decisions.filter(
      (decision) =>
        decision.iconKey !== decision.food.iconKey ||
        decision.iconSource !== decision.food.iconSource,
    );
    for (const decision of decisions) {
      if (decision.method === "meilisearch") report.meilisearch++;
      else if (decision.method === "existing-llm") report.existingLlm++;
      else if (decision.method === "existing-specific")
        report.existingSpecific++;
      else if (decision.method === "llm") report.llm++;
      else report.unresolved++;
      report.iconCounts[decision.iconKey] =
        (report.iconCounts[decision.iconKey] ?? 0) + 1;
      if (decision.iconKey !== decision.food.iconKey) {
        report.changedIcons++;
        if (report.samples.length < 100)
          report.samples.push({
            name: decision.food.name,
            query: decision.query,
            previous: decision.food.iconKey,
            proposed: decision.iconKey,
            method: decision.method,
          });
      }
    }
    report.changedRows += changes.length;
    if (backup && changes.length) {
      await backup.writeFile(
        `${changes.map((decision) => JSON.stringify({ id: decision.food.id, previousIconKey: decision.food.iconKey, previousIconSource: decision.food.iconSource, iconKey: decision.iconKey, iconSource: decision.iconSource, method: decision.method })).join("\n")}\n`,
      );
      await backup.sync();
    }
    if (!dryRun && changes.length) {
      const updated = await pool.query(
        `update items set icon_key = u.icon_key, icon_source = u.icon_source, updated_at = now() from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) as u(id, icon_key, icon_source, previous_icon_key, previous_icon_source) where items.id = u.id and items.icon_key = u.previous_icon_key and items.icon_source = u.previous_icon_source`,
        [
          changes.map((decision) => decision.food.id),
          changes.map((decision) => decision.iconKey),
          changes.map((decision) => decision.iconSource),
          changes.map((decision) => decision.food.iconKey),
          changes.map((decision) => decision.food.iconSource),
        ],
      );
      report.written += updated.rowCount ?? 0;
    }
    report.scanned += foods.length;
    cursor = foods.at(-1)?.id ?? cursor;
    if (report.scanned % 10_000 === 0 || limit)
      console.log(
        JSON.stringify({
          scanned: report.scanned,
          meilisearch: report.meilisearch,
          existingLlm: report.existingLlm,
          unresolved: report.unresolved,
          changedIcons: report.changedIcons,
          written: report.written,
        }),
      );
    await writeFile(
      reportPath,
      `${JSON.stringify({ ...report, dryRun, version }, null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify({
      ...report,
      samples: undefined,
      iconCounts: undefined,
      dryRun,
    }),
  );
} finally {
  await backup?.close();
  cache.close();
  await pool.end();
}
