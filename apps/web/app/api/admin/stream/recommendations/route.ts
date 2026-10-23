import {
  type RecommendationResponse,
  recommendationRequestSchema,
} from "@repo/schemas/stream";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateStructured } from "@/lib/llm-service";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 40_000;

const SYSTEM = [
  "You choose films and series for one person, or a few watching together, from a family's private catalogue.",
  "You may only pick ids from the candidate list; never invent a title.",
  "Order picks best first. Balance closeness to their taste with a little variety, and favour well-rated titles.",
  'Each reason is one short, warm sentence addressed to the viewer ("Because you loved …", "A sharp heist thriller like …"), at most 120 characters, naming a title from their history when it helps.',
  "When several people watch together, address them as a group and pick what they would enjoy together.",
  "If anyone watching is a kids profile, pick only titles clearly suitable for children.",
].join(" ");

const pickSchema = z.object({
  picks: z.array(
    z.object({ id: z.string(), reason: z.string().min(1).max(160) }),
  ),
});

/**
 * Stream's server sends a profile's history and a candidate pool it already
 * filtered; the model only ranks within it and explains each pick.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = recommendationRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { audience, history, candidates, count } = parsed.data;
  const describe = (item: (typeof candidates)[number]) =>
    `${item.id} | ${item.title}${item.year ? ` (${item.year})` : ""} | ${item.type} | ${item.genres.join("/")} | ${item.rating ?? "–"}`;
  const prompt = [
    audience.length > 1
      ? `Watching together: ${audience.map((person) => person.name).join(", ")}. Every pick must suit all of them.`
      : `Watching alone: ${audience[0]?.name}.`,
    ...audience.map(
      (person) =>
        `${person.name}: ${person.kids ? "kids profile" : "adult"}; favourite genres: ${person.favoriteGenres.join(", ") || "none given"}.`,
    ),
    "",
    "History (who — signal: finished, watching, watchlist or abandoned):",
    history.length > 0
      ? history
          .map((item) => `${item.who} — ${item.signal}: ${describe(item)}`)
          .join("\n")
      : "nothing yet — rely on favourite genres and quality",
    "",
    `Candidates (id | title | type | genres | rating). Pick ${count}:`,
    candidates.map(describe).join("\n"),
  ].join("\n");

  try {
    const { output } = await generateStructured({
      purpose: "stream-recommend",
      source: "stream-recommendations",
      model: process.env.STREAM_RECOMMEND_MODEL || DEFAULT_MODEL,
      system: SYSTEM,
      prompt,
      schema: pickSchema,
      fast: true,
      timeoutMs: TIMEOUT_MS,
      signal: request.signal,
    });
    const allowed = new Set(candidates.map((item) => item.id));
    const seen = new Set<string>();
    const response: RecommendationResponse = {
      picks: output.picks
        .filter((pick) => {
          if (!allowed.has(pick.id) || seen.has(pick.id)) return false;
          seen.add(pick.id);
          return true;
        })
        .slice(0, count),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[stream recommendations] generation failed", error);
    return NextResponse.json(
      { error: "Recommendation failed" },
      { status: 502 },
    );
  }
}
