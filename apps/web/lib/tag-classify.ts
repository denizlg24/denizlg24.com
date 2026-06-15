import { calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import { TagGroup } from "@/models/TagGroup";

// Broad, user-facing topic groups. Freeform admin tags are classified into
// exactly one of these by a light LLM so the public filter stays legible.
export const TOPIC_GROUPS = [
  "Engineering",
  "Design",
  "Product",
  "Infrastructure",
  "Career",
  "Personal",
] as const;
export const FALLBACK_GROUP = "Other";

const ALLOWED_GROUPS = new Set<string>([...TOPIC_GROUPS, FALLBACK_GROUP]);

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const SOURCE = "tag-topic-classify";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function semanticModel() {
  return process.env.SEMANTIC_LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function semanticBaseUrl() {
  return (
    process.env.SEMANTIC_LLM_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

function semanticApiKey() {
  return process.env.SEMANTIC_LLM_API_KEY?.trim();
}

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
}

function parseJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function coerceGroup(value: unknown): string {
  return typeof value === "string" && ALLOWED_GROUPS.has(value)
    ? value
    : FALLBACK_GROUP;
}

// Classifies already-normalized (lowercase) tags into topic groups via DeepSeek.
// Any failure degrades gracefully to the fallback group so saves never break.
async function classifyViaLlm(tags: string[]): Promise<Record<string, string>> {
  const apiKey = semanticApiKey();
  if (!apiKey || tags.length === 0) {
    return Object.fromEntries(tags.map((tag) => [tag, FALLBACK_GROUP]));
  }

  const model = semanticModel();
  const system = `You classify freeform content tags into ONE broad topic group for a personal site's blog and project filter.
Allowed groups: ${[...TOPIC_GROUPS, FALLBACK_GROUP].join(", ")}.
Return ONLY a JSON object mapping each input tag (verbatim, lowercase) to exactly one allowed group. Use "${FALLBACK_GROUP}" only when no other group reasonably fits.`;
  const user = JSON.stringify({ tags });

  try {
    const response = await fetch(`${semanticBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Tag classification request failed: ${response.status}`);
    }

    const json = (await response.json()) as ChatResponse;
    const content = json.choices?.[0]?.message?.content ?? "";
    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;
    await logLlmUsage({
      llmModel: model,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(model, inputTokens, outputTokens),
      systemPrompt: system,
      userPrompt: user,
      source: SOURCE,
    });

    const parsed = parseJsonObject<Record<string, unknown>>(content) ?? {};
    return Object.fromEntries(
      tags.map((tag) => [tag, coerceGroup(parsed[tag])]),
    );
  } catch (error) {
    console.error("Tag classification failed:", error);
    return Object.fromEntries(tags.map((tag) => [tag, FALLBACK_GROUP]));
  }
}

// Returns a normalizedTag -> group map for the given raw tags, classifying and
// persisting any tags not already in the TagGroup cache.
async function ensureTagMappings(
  rawTags: string[],
): Promise<Map<string, string>> {
  await connectDB();
  const normalized = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  if (normalized.length === 0) return new Map();

  const existing = await TagGroup.find({ tag: { $in: normalized } })
    .lean()
    .exec();
  const map = new Map(existing.map((entry) => [entry.tag, entry.group]));

  const missing = normalized.filter((tag) => !map.has(tag));
  if (missing.length > 0) {
    const classified = await classifyViaLlm(missing);
    for (const tag of missing) {
      const group = classified[tag] ?? FALLBACK_GROUP;
      map.set(tag, group);
      await TagGroup.updateOne(
        { tag },
        { $set: { group } },
        { upsert: true },
      ).exec();
    }
  }

  return map;
}

export async function computeTopicGroups(rawTags: string[]): Promise<string[]> {
  if (!rawTags || rawTags.length === 0) return [];
  const map = await ensureTagMappings(rawTags);
  const groups = new Set<string>();
  for (const tag of rawTags) {
    const group = map.get(normalizeTag(tag));
    if (group) groups.add(group);
  }
  return [...groups];
}
