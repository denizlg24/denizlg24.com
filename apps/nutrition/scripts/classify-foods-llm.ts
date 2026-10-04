import { Pool } from "pg";

import { researchSources } from "../src/db/schema";
import { buildIconCatalog, renderCatalog } from "./food-icons/catalog";

/**
 * Reassigns every food's icon with a small model, replacing the regex rules
 * where they fell through, and names composition-table foods with a
 * canonical English concept ("banana, raw") that `concepts:link` uses to
 * match the same food across tables.
 *
 *   bun run icons:classify -- --dry-run --limit 400
 *   bun run icons:classify                      # resumable: skips rows already classified
 *
 * Writes after every batch, so an interrupted run resumes where it stopped.
 */

const readOption = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const args = {
  model: readOption("--model", "openai/gpt-6-luna"),
  batchSize: Number(readOption("--batch-size", "120")),
  concurrency: Number(readOption("--concurrency", "8")),
  limit: Number(readOption("--limit", "0")),
  source: readOption("--source", ""),
  dryRun: Bun.argv.includes("--dry-run"),
  redo: Bun.argv.includes("--redo"),
  reasoning: readOption("--reasoning", "minimal"),
};

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const research = new Set<string>(researchSources);

interface Candidate {
  id: string;
  name: string;
  nameEn: string | null;
  brand: string | null;
  foodGroup: string | null;
  source: string;
}

interface Assignment {
  iconKey: string;
  conceptName: string | null;
}

const systemPrompt = (
  catalog: string,
) => `You assign food icons. Each catalog line is an icon key followed by the foods it depicts.

<catalog>
${catalog}
</catalog>

Rules:
- Copy keys exactly from the catalog.
- Match the food's dominant visual identity, not its nutrition: "Beef, ground, raw" is beef; "Greek yogurt with honey" is yogurt; a chocolate bar is chocolate even if it contains nuts.
- Preparation words (raw, cooked, boiled, canned, frozen) and pack sizes do not change the icon.
- Names can be in any language (Portuguese, French, German, Danish, Swedish, Norwegian, Japanese...). Translate mentally before matching.
- Use "other-001" only when nothing in the catalog is a reasonable depiction.
- For items marked [R], also give "concept": the generic food in at most four English words, lowercase, singular, as "<food>" or "<food>, <state>". State is one of: raw, cooked, boiled, steamed, fried, roasted, grilled, baked, dried, canned, frozen, smoked. Drop brands, origins, cultivars, fortification, packaging, fat or salt levels and minor qualifiers, except where they define a distinct everyday product (whole milk, skimmed milk, dark chocolate). Examples: "blueberry muffin", "margarine", "chokecherry, raw", "chicken breast, roasted", "whole milk", "white rice, boiled", "cheddar". The same food from different countries' tables must get the identical concept. For items not marked [R], concept is null.`;

const describe = (item: Candidate, index: number) => {
  const names =
    item.nameEn && item.nameEn !== item.name
      ? `${item.name} / ${item.nameEn}`
      : item.name;
  const extra = [
    item.brand ? `brand: ${item.brand}` : "",
    item.foodGroup ? `group: ${item.foodGroup}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return `${index}. ${research.has(item.source) ? "[R] " : ""}${names}${extra ? ` (${extra})` : ""}`;
};

const responseFormat = (withConcepts: boolean) => ({
  type: "json_schema",
  json_schema: {
    name: "icon_assignments",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: withConcepts ? ["i", "key", "concept"] : ["i", "key"],
            properties: {
              i: { type: "integer" },
              key: { type: "string" },
              // Product batches never carry concepts; leaving the field out
              // saves a third of the output tokens, which bound throughput.
              ...(withConcepts
                ? { concept: { type: ["string", "null"] } }
                : {}),
            },
          },
        },
      },
    },
  },
});

const usage = { input: 0, cachedInput: 0, output: 0, calls: 0, failed: 0 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const classifyBatch = async (
  system: string,
  batch: Candidate[],
  validKeys: Set<string>,
): Promise<Map<string, Assignment>> => {
  const apiKey = Bun.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: batch.map(describe).join("\n") },
        ],
        // Matching a name to a catalog line needs no deliberation; hidden
        // reasoning tokens were most of the output and all of the latency.
        reasoning_effort: args.reasoning,
        response_format: responseFormat(
          batch.some((item) => research.has(item.source)),
        ),
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => error);

    if (
      !(response instanceof Response) ||
      response.status === 429 ||
      response.status >= 500
    ) {
      await Bun.sleep(2 ** attempt * 2_000);
      continue;
    }
    if (!response.ok)
      throw new Error(`${response.status}: ${await response.text()}`);

    const body: unknown = await response.json();
    if (!isRecord(body)) return new Map();
    const tokens = body.usage;
    if (isRecord(tokens)) {
      usage.input += Number(tokens.prompt_tokens ?? 0);
      usage.output += Number(tokens.completion_tokens ?? 0);
      const details = tokens.prompt_tokens_details;
      if (isRecord(details))
        usage.cachedInput += Number(details.cached_tokens ?? 0);
    }
    usage.calls += 1;

    const choices = body.choices;
    const message =
      Array.isArray(choices) && isRecord(choices[0])
        ? choices[0].message
        : undefined;
    const content = isRecord(message) ? message.content : undefined;
    if (typeof content !== "string") return new Map();

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    const entries =
      isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
    const result = new Map<string, Assignment>();
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry.i !== "number" ||
        typeof entry.key !== "string"
      )
        continue;
      const item = batch[entry.i];
      // Anything the model invented is dropped; the row keeps its current icon.
      if (!item || !validKeys.has(entry.key)) continue;
      const concept =
        research.has(item.source) &&
        typeof entry.concept === "string" &&
        entry.concept.trim()
          ? entry.concept.trim().toLowerCase()
          : null;
      result.set(item.id, { iconKey: entry.key, conceptName: concept });
    }
    return result;
  }

  usage.failed += 1;
  return new Map();
};

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const system = systemPrompt(
    renderCatalog(await buildIconCatalog("config/food-icons/rules.json")),
  );
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.max(4, args.concurrency),
  });

  try {
    const { rows: iconRows } = await pool.query<{ key: string }>(
      "select key from food_icons",
    );
    const validKeys = new Set(iconRows.map((row) => row.key));

    const filters = ["merged_into is null", "not quarantined"];
    if (!args.redo) filters.push("icon_source <> 'llm'");
    const params: unknown[] = [];
    if (args.source) {
      params.push(args.source.split(","));
      filters.push(`source = any($${params.length}::text[])`);
    }
    const where = filters.join(" and ");
    const { rows: countRows } = await pool.query<{ n: string }>(
      `select count(*)::bigint as n from items where ${where}`,
      params,
    );
    const total = Math.min(
      Number(countRows[0]?.n ?? 0),
      args.limit || Number.POSITIVE_INFINITY,
    );
    console.log(
      `To classify: ${total} with ${args.model}${args.dryRun ? " (dry run)" : ""}`,
    );

    let cursor = "00000000-0000-0000-0000-000000000000";
    let fetched = 0;
    let classified = 0;
    let written = 0;
    const started = performance.now();
    const samples: string[] = [];

    const nextBatch = async (): Promise<Candidate[]> => {
      if (args.limit && fetched >= args.limit) return [];
      const size = args.limit
        ? Math.min(args.batchSize, args.limit - fetched)
        : args.batchSize;
      const { rows } = await pool.query<Candidate>(
        `select id, name, name_en as "nameEn", brand, food_group as "foodGroup", source
           from items where ${where} and id > $${params.length + 1}
          order by id limit $${params.length + 2}`,
        [...params, cursor, size],
      );
      const last = rows.at(-1);
      if (last) cursor = last.id;
      fetched += rows.length;
      return rows;
    };

    // One query hands out batches so workers never overlap.
    let queue = Promise.resolve<Candidate[]>([]);
    const take = () => {
      queue = queue.then(() => nextBatch());
      return queue;
    };

    await Promise.all(
      Array.from({ length: Math.max(1, args.concurrency) }, async () => {
        for (;;) {
          const batch = await take();
          if (batch.length === 0) return;
          const result = await classifyBatch(system, batch, validKeys);
          classified += result.size;

          if (samples.length < 25) {
            for (const item of batch.slice(0, 3)) {
              const assignment = result.get(item.id);
              if (assignment) {
                samples.push(
                  `${assignment.iconKey.padEnd(22)} ${item.name.slice(0, 60)}${assignment.conceptName ? `  => ${assignment.conceptName}` : ""}`,
                );
              }
            }
          }

          if (!args.dryRun && result.size > 0) {
            const ids = [...result.keys()];
            const updated = await pool.query(
              `update items set icon_key = u.icon_key, icon_source = 'llm',
                      concept_name = coalesce(u.concept_name, items.concept_name)
                 from unnest($1::uuid[], $2::text[], $3::text[]) as u(id, icon_key, concept_name)
                where items.id = u.id`,
              [
                ids,
                ids.map((id) => result.get(id)?.iconKey),
                ids.map((id) => result.get(id)?.conceptName ?? null),
              ],
            );
            written += updated.rowCount ?? 0;
          }

          if (usage.calls % 100 === 0) {
            const rate = classified / ((performance.now() - started) / 1000);
            console.log(
              `  ${classified}/${total} classified, ${rate.toFixed(0)}/s, calls=${usage.calls} failed=${usage.failed} ` +
                `tokens in=${usage.input} (cached ${usage.cachedInput}) out=${usage.output}`,
            );
          }
        }
      }),
    );

    console.log(
      `\nClassified ${classified}/${total}. calls=${usage.calls} failed=${usage.failed} ` +
        `tokens in=${usage.input} (cached ${usage.cachedInput}) out=${usage.output}`,
    );
    for (const sample of samples) console.log(`  ${sample}`);
    if (!args.dryRun) console.log(`Rows written: ${written}`);
  } finally {
    await pool.end();
  }
};

await main();
