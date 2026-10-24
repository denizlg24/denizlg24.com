import { assistantPromptSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, requireAudience } from "@/lib/api";
import { askAssistant } from "@/lib/assistant";

export const maxDuration = 90;

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  const prompt = assistantPromptSchema.safeParse(
    new URL(request.url).searchParams.get("q") ?? "",
  );
  if (!prompt.success) return fail(400, "Ask for something to watch");
  return NextResponse.json(await askAssistant(caller.profiles, prompt.data));
}
