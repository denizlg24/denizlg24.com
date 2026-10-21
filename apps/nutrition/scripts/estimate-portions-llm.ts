import { householdServings } from "@repo/macros-core/foods/portions";
import { Pool } from "pg";

/**
 * Estimates household measures ("1 medium", "1 cup, chopped") for generic
 * USDA foods that neither publish one nor borrowed one through
 * `portions:propagate`. Run propagation first.
 *
 *   bun run portions:estimate -- --dry-run
 *   bun run portions:estimate
 *
 * Rows are written with origin `llm`, only for items holding no portions at
 * all, so a re-run touches only what is still missing.
 */

const readOption = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const args = {
  model: readOption("--model", "openai/gpt-6-luna"),
  batchSize: Number(readOption("--batch-size", "40")),
  dryRun: Bun.argv.includes("--dry-run"),
};

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const SOURCES = ["usda_foundation", "usda_sr_legacy", "usda_fndds"];
const MAX_PORTIONS = 4;
const MAX_GRAMS = 5_000;

interface Candidate {
  id: string;
  name: string;
  foodGroup: string | null;
}

interface Estimate {
  label: string;
  grams: number;
}

const system = `You give household measures for foods, with gram weights, as a food composition table would publish them.

Rules:
- Up to ${MAX_PORTIONS} measures a person would actually use to log this food: natural units with sizes where they vary ("1 small", "1 medium", "1 large", "1 fillet", "1 tail", "1 leg"), then common kitchen measures ("1 cup, sliced", "1 tbsp").
- Labels start with a count, normally 1. Never a metric label ("100 g", "250 ml") or an ounce label.
- Grams are for the food exactly as named: its preparation state, peeled or not, with or without bone. Use typical USDA weights.
- Return an empty list when no household measure makes sense (organ fat, bone marrow, a rendered ingredient sold by weight).`;

const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "portion_estimates",
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
            required: ["i", "portions"],
            properties: {
              i: { type: "integer" },
              portions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "grams"],
                  properties: {
                    label: { type: "string" },
                    grams: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const usage = { input: 0, output: 0, calls: 0 };

/** Keeps what the logging screen would offer, within a plausible weight. */
const accept = (entries: unknown): Estimate[] => {
  if (!Array.isArray(entries)) return [];
  const estimates = entries.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.label === "string" &&
    typeof entry.grams === "number" &&
    entry.grams > 0 &&
    entry.grams <= MAX_GRAMS
      ? [{ label: entry.label.trim(), grams: entry.grams }]
      : [],
  );
  return estimates
    .filter((estimate) => householdServings([estimate]).length > 0)
    .slice(0, MAX_PORTIONS);
};

const estimateBatch = async (
  batch: Candidate[],
): Promise<Map<string, Estimate[]>> => {
  const apiKey = Bun.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required");
  const prompt = batch
    .map(
      (item, index) =>
        `${index}. ${item.name}${item.foodGroup ? ` (group: ${item.foodGroup})` : ""}`,
    )
    .join("\n");

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
          { role: "user", content: prompt },
        ],
        reasoning_effort: "low",
        response_format: responseFormat,
      }),
      signal: AbortSignal.timeout(180_000),
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
    if (isRecord(body.usage)) {
      usage.input += Number(body.usage.prompt_tokens ?? 0);
      usage.output += Number(body.usage.completion_tokens ?? 0);
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
    const result = new Map<string, Estimate[]>();
    const entries =
      isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.i !== "number") continue;
      const item = batch[entry.i];
      if (item) result.set(item.id, accept(entry.portions));
    }
    return result;
  }
  throw new Error("Portion estimate kept failing after retries");
};

const main = async () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  try {
    const { rows } = await pool.query<Candidate>(
      `select i.id, i.name, i.food_group as "foodGroup"
         from items i
        where i.source = any($1::text[])
          and not i.quarantined and i.removed_at is null
          and i.merged_into is null
          and not exists (select 1 from item_portions p where p.item_id = i.id)
        order by i.name`,
      [SOURCES],
    );
    console.log(`candidates=${rows.length} model=${args.model}`);

    let written = 0;
    let empty = 0;
    for (let offset = 0; offset < rows.length; offset += args.batchSize) {
      const batch = rows.slice(offset, offset + args.batchSize);
      const estimates = await estimateBatch(batch);
      for (const item of batch) {
        const portions = estimates.get(item.id) ?? [];
        if (portions.length === 0) {
          empty += 1;
          continue;
        }
        if (args.dryRun) {
          console.log(
            `  ${item.name}: ${portions.map((portion) => `${portion.label}=${portion.grams}`).join(", ")}`,
          );
          continue;
        }
        await pool.query(
          `insert into item_portions (item_id, label, grams, sort_order, origin)
           select $1, u.label, u.grams, u.sort_order - 1, 'llm'
             from unnest($2::text[], $3::numeric[]) with ordinality
                  as u(label, grams, sort_order)
           on conflict (item_id, label) do nothing`,
          [
            item.id,
            portions.map((portion) => portion.label),
            portions.map((portion) => portion.grams),
          ],
        );
        written += 1;
      }
      console.log(
        `progress=${Math.min(offset + args.batchSize, rows.length)}/${rows.length}`,
      );
    }
    console.log(
      `items_written=${written} no_measure=${empty} calls=${usage.calls} input_tokens=${usage.input} output_tokens=${usage.output}`,
    );
  } finally {
    await pool.end();
  }
};

await main();
