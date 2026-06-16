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

// Fixed groups for projects. Unlike blog tags (classified one tag at a time),
// projects are classified as a whole — title, subtitle, tags and body together —
// because "Fullstack" vs "Frontend" is a property of the project, not of any
// single tag. The LLM picks one or two of these per project.
export const PROJECT_GROUPS = [
  "Frontend",
  "Fullstack",
  "Infrastructure",
  "Hardware/Software",
] as const;

const ALLOWED_GROUPS = new Set<string>([...TOPIC_GROUPS, FALLBACK_GROUP]);
const ALLOWED_PROJECT_GROUPS = new Set<string>([
  ...PROJECT_GROUPS,
  FALLBACK_GROUP,
]);

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const SOURCE = "tag-topic-classify";
const PROJECT_SOURCE = "project-topic-classify";

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

// Posts a chat-completion request to the semantic LLM and returns the parsed
// JSON object from its response, logging usage. Returns null on any failure so
// callers can degrade to a fallback instead of breaking the save.
async function requestJsonCompletion(
  system: string,
  user: string,
  source: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = semanticApiKey();
  if (!apiKey) return null;
  const model = semanticModel();

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
      throw new Error(`Classification request failed: ${response.status}`);
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
      source,
    });

    return parseJsonObject<Record<string, unknown>>(content) ?? {};
  } catch (error) {
    console.error("Classification failed:", error);
    return null;
  }
}

// Classifies already-normalized (lowercase) blog tags into ONE fixed topic group
// each. Any failure degrades gracefully to the fallback group.
async function classifyTagsViaLlm(
  tags: string[],
): Promise<Record<string, string>> {
  if (tags.length === 0) return {};
  const system = `You classify freeform blog content tags into ONE broad topic group for a personal site's blog filter.
Allowed groups: ${[...TOPIC_GROUPS, FALLBACK_GROUP].join(", ")}.
Return ONLY a JSON object mapping each input tag (verbatim, lowercase) to exactly one allowed group. Use "${FALLBACK_GROUP}" only when no other group reasonably fits.`;
  const user = JSON.stringify({ tags });

  const parsed = await requestJsonCompletion(system, user, SOURCE);
  if (!parsed) {
    return Object.fromEntries(tags.map((tag) => [tag, FALLBACK_GROUP]));
  }
  return Object.fromEntries(
    tags.map((tag) => [tag, coerceFixedGroup(parsed[tag])]),
  );
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
    const classified = await classifyTagsViaLlm(missing);
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

export interface ProjectClassificationInput {
  title: string;
  subtitle?: string;
  tags?: string[];
  markdown?: string;
}

// Body text only feeds the classifier signal; trimming keeps token cost bounded
// for long write-ups without losing the lede that usually frames the project.
const PROJECT_BODY_CHAR_LIMIT = 2000;

function coerceProjectGroups(value: unknown): string[] {
  if (!Array.isArray(value)) return [FALLBACK_GROUP];
  const groups = [
    ...new Set(
      value.filter(
        (group): group is string =>
          typeof group === "string" && ALLOWED_PROJECT_GROUPS.has(group),
      ),
    ),
  ];
  return groups.length > 0 ? groups : [FALLBACK_GROUP];
}

// Classifies a whole project (not its tags individually) into one or two fixed
// project groups. Degrades to the fallback group on any failure so saves never
// break.
export async function computeProjectTopicGroups(
  input: ProjectClassificationInput,
): Promise<string[]> {
  const system = `You classify a software project into its topic group(s) for a personal site's project filter.
Allowed groups: ${[...PROJECT_GROUPS, FALLBACK_GROUP].join(", ")}.
- "Frontend": primarily UI/client work with no backend the author built.
- "Fullstack": the author built both client and server/data layers.
- "Infrastructure": DevOps, hosting, networking, monitoring, CI/CD, self-hosted services, storage/ops systems.
- "Hardware/Software": embedded, IoT, firmware, or projects bridging physical hardware and code.
Assign one or two groups, most specific first. Prefer "Fullstack" over "Frontend" when both apply; do not return both.
When a project centrally involves self-hosting, DevOps, networking, or running/operating its own infrastructure, include "Infrastructure" even alongside "Fullstack". Add "Hardware/Software" alongside another group when physical hardware is involved.
Use "${FALLBACK_GROUP}" only when none fit.
Return ONLY a JSON object: { "groups": ["..."] }.`;
  const user = JSON.stringify({
    title: input.title,
    subtitle: input.subtitle ?? "",
    tags: input.tags ?? [],
    body: (input.markdown ?? "").slice(0, PROJECT_BODY_CHAR_LIMIT),
  });

  const parsed = await requestJsonCompletion(system, user, PROJECT_SOURCE);
  if (!parsed) return [FALLBACK_GROUP];
  return coerceProjectGroups(parsed.groups);
}
