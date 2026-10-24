import {
  type AssistantIntentRequest,
  assistantIntentRequestSchema,
  assistantIntentSchema,
  STREAM_GENRES,
} from "@repo/schemas/stream";
import { type NextRequest, NextResponse } from "next/server";
import { generateStructured } from "@/lib/llm-service";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 20_000;

const SYSTEM = [
  "You turn what someone asks a family's film and series catalogue for into search filters.",
  `Genres must come from this list: ${STREAM_GENRES.join(", ")}.`,
  'Only set a filter the request actually implies; leave the rest null or empty. A vague request ("something good") sets almost nothing.',
  'mood is "light" for funny, cosy, feel-good or family requests, "heavy" for dark, intense or scary ones, otherwise "any".',
  'Decades become year ranges ("90s" is 1990 to 1999); "recent" or "new" means the last three years before the current year.',
  '"short" for a film means runtimeMax around 100; for a series leave runtime null.',
  "languages are ISO 639-1 codes of the original language, set only when a language or country is named.",
  "similarTo holds titles the person names as a reference. keywords are concrete plot or setting words likely to appear in a synopsis, in English.",
].join(" ");

function prompt(input: AssistantIntentRequest): string {
  return [
    `Current year: ${input.year}.`,
    input.kids
      ? "A child is watching, so the result must suit children."
      : "Adults are watching.",
    `Request: ${input.prompt}`,
  ].join("\n");
}

/** Stream asks for filters, then builds the candidate pool from its own catalogue. */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = assistantIntentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  try {
    const { output } = await generateStructured({
      purpose: "stream-assistant",
      source: "stream-assistant",
      model: process.env.STREAM_ASSISTANT_MODEL || DEFAULT_MODEL,
      system: SYSTEM,
      prompt: prompt(parsed.data),
      schema: assistantIntentSchema,
      fast: true,
      timeoutMs: TIMEOUT_MS,
      signal: request.signal,
    });
    return NextResponse.json({ intent: output });
  } catch (error) {
    console.error("[stream assistant] intent failed", error);
    return NextResponse.json({ error: "Intent failed" }, { status: 502 });
  }
}
