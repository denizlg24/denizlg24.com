import { calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import { type TagContext, TagGroup } from "@/models/TagGroup";

// Broad, user-facing topic groups for blog content. Freeform admin tags are
// classified into exactly one of these by a light LLM so the public filter
// stays legible. Blog classification is "fixed": tags must map to this set.
export const TOPIC_GROUPS = [
  "Engineering",
  "Design",
  "Product",
  "Infrastructure",
  "Career",
  "Personal",
] as const;
export const FALLBACK_GROUP = "Other";

// Starter groups for projects. Unlike blogs, project classification is
// "hybrid": the LLM may reuse an existing project group or invent a new short
// one when none fit, seeded with these so the filter isn't empty on day one.
export const PROJECT_SEED_GROUPS = [
  "Web",
  "Mobile",
  "AI/ML",
  "DevOps",
  "Developer Tools",
  "Data",
  "Games",
  "Hardware/IoT",
] as const;

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

// Fixed mode (blogs): the value must be one of the allowed groups.
function coerceFixedGroup(value: unknown): string {
  return typeof value === "string" && ALLOWED_GROUPS.has(value)
    ? value
    : FALLBACK_GROUP;
}

// Hybrid mode (projects): accept any non-empty group the LLM returns, but snap
// it to an existing registry entry's spelling when it matches case-insensitively
// so we don't fragment into "DevOps"/"devops"/"Dev Ops". Empty -> fallback.
function coerceHybridGroup(
  value: unknown,
  canonicalByLower: Map<string, string>,
): string {
  if (typeof value !== "string") return FALLBACK_GROUP;
  const trimmed = value.trim();
  if (!trimmed) return FALLBACK_GROUP;
  return canonicalByLower.get(trimmed.toLowerCase()) ?? trimmed;
}

type ClassifyOptions =
  | { mode: "fixed" }
  | { mode: "hybrid"; registry: string[] };

// Classifies already-normalized (lowercase) tags into topic groups via DeepSeek.
// Any failure degrades gracefully to the fallback group so saves never break.
async function classifyViaLlm(
  tags: string[],
  options: ClassifyOptions,
): Promise<Record<string, string>> {
  const apiKey = semanticApiKey();
  if (!apiKey || tags.length === 0) {
    return Object.fromEntries(tags.map((tag) => [tag, FALLBACK_GROUP]));
  }

  const canonicalByLower =
    options.mode === "hybrid"
      ? new Map(options.registry.map((group) => [group.toLowerCase(), group]))
      : new Map<string, string>();

  const model = semanticModel();
  const system =
    options.mode === "fixed"
      ? `You classify freeform blog content tags into ONE broad topic group for a personal site's blog filter.
Allowed groups: ${[...TOPIC_GROUPS, FALLBACK_GROUP].join(", ")}.
Return ONLY a JSON object mapping each input tag (verbatim, lowercase) to exactly one allowed group. Use "${FALLBACK_GROUP}" only when no other group reasonably fits.`
      : `You classify software-project tags (tech, tooling, domains) into ONE short topic group for a personal site's project filter.
Existing groups: ${options.registry.join(", ")}.
Reuse one of the existing groups whenever it reasonably fits. Only invent a new short group name (1-2 words, Title Case) when none of the existing groups fit.
Return ONLY a JSON object mapping each input tag (verbatim, lowercase) to exactly one group.`;
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
      tags.map((tag) => [
        tag,
        options.mode === "fixed"
          ? coerceFixedGroup(parsed[tag])
          : coerceHybridGroup(parsed[tag], canonicalByLower),
      ]),
    );
  } catch (error) {
    console.error("Tag classification failed:", error);
    return Object.fromEntries(tags.map((tag) => [tag, FALLBACK_GROUP]));
  }
}

// Builds the classifier options for a context. Projects classify in hybrid mode
// against a registry of seed groups plus any groups already invented for prior
// project tags, so the taxonomy grows coherently instead of fragmenting.
async function classifyOptionsFor(
  context: TagContext,
): Promise<ClassifyOptions> {
  if (context === "blog") return { mode: "fixed" };
  const invented = await TagGroup.distinct("group", { context: "project" });
  const registry = [
    ...new Set([...PROJECT_SEED_GROUPS, ...invented, FALLBACK_GROUP]),
  ];
  return { mode: "hybrid", registry };
}

// Returns a normalizedTag -> group map for the given raw tags, classifying and
// persisting any tags not already in the TagGroup cache for this context.
async function ensureTagMappings(
  rawTags: string[],
  context: TagContext,
): Promise<Map<string, string>> {
  await connectDB();
  const normalized = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  if (normalized.length === 0) return new Map();

  const existing = await TagGroup.find({ tag: { $in: normalized }, context })
    .lean()
    .exec();
  const map = new Map(existing.map((entry) => [entry.tag, entry.group]));

  const missing = normalized.filter((tag) => !map.has(tag));
  if (missing.length > 0) {
    const classified = await classifyViaLlm(
      missing,
      await classifyOptionsFor(context),
    );
    for (const tag of missing) {
      const group = classified[tag] ?? FALLBACK_GROUP;
      map.set(tag, group);
      await TagGroup.updateOne(
        { tag, context },
        { $set: { group } },
        { upsert: true },
      ).exec();
    }
  }

  return map;
}

export async function computeTopicGroups(
  rawTags: string[],
  context: TagContext,
): Promise<string[]> {
  if (!rawTags || rawTags.length === 0) return [];
  const map = await ensureTagMappings(rawTags, context);
  const groups = new Set<string>();
  for (const tag of rawTags) {
    const group = map.get(normalizeTag(tag));
    if (group) groups.add(group);
  }
  return [...groups];
}
