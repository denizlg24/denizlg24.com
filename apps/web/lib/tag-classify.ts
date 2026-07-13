import { generateJson } from "@/lib/llm-service";
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

const ALLOWED_GROUPS = new Set<string>([...TOPIC_GROUPS, FALLBACK_GROUP]);

const SOURCE = "tag-topic-classify";

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
}

// Fixed mode (blogs): the value must be one of the allowed groups.
function coerceFixedGroup(value: unknown): string {
  return typeof value === "string" && ALLOWED_GROUPS.has(value)
    ? value
    : FALLBACK_GROUP;
}

// Requests a JSON-object completion from the LLM service (configured
// semantic model). Returns null on any failure — missing credentials,
// transport errors — so callers degrade to a fallback instead of breaking
// the save.
async function requestJsonCompletion(
  system: string,
  user: string,
  source: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { json } = await generateJson<Record<string, unknown>>({
      purpose: "topic-classify",
      source,
      system,
      user,
      temperature: 0,
    });
    return json ?? {};
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
