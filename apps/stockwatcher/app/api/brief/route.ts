import { createTextStreamResponse, streamText, toTextStream } from "ai";
import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";
import { getBrief, listMemories, saveBrief } from "@/lib/memory";
import { aiEnabled, briefModel } from "@/lib/ai/config";
import { briefDataPack } from "@/lib/ai/brief";
import { briefInstructions } from "@/lib/ai/prompt";

export const maxDuration = 90;

const dateSchema = z.iso
  .date()
  .refine(
    (date) => Date.parse(date) <= Date.now() + 2 * 86_400_000,
    "Choose today's date or a past date.",
  );

const serverToday = () => new Date().toISOString().slice(0, 10);

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view the brief." }, 401);
  const param = new URL(request.url).searchParams.get("date") ?? serverToday();
  const date = dateSchema.safeParse(param);
  if (!date.success) return json({ error: "Enter a date as YYYY-MM-DD." }, 400);
  try {
    return json(await getBrief(user.id, date.data));
  } catch {
    return json({ error: "The brief could not be loaded." }, 502);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to generate a brief." }, 401);
  if (!aiEnabled(user))
    return json(
      { error: "The AI brief is unavailable for this session." },
      503,
    );
  const body = await request.json().catch(() => null);
  const input = z.object({ date: dateSchema }).safeParse(body);
  if (!input.success)
    return json({ error: "Enter a date as YYYY-MM-DD." }, 400);
  const { date } = input.data;

  const [workspace, memories] = await Promise.all([
    readWorkspace(user.id),
    listMemories(user.id).catch(() => []),
  ]);
  const pack = await briefDataPack(workspace.data, memories);

  const result = streamText({
    model: briefModel(),
    instructions: briefInstructions({ name: user.name, date }),
    prompt: `Data pack (JSON):\n${pack}\n\nWrite the brief for ${date}.`,
    maxOutputTokens: 1200,
    timeout: { totalMs: 80_000 },
    onEnd: async ({ text, finishReason }) => {
      const content = text.trim();
      if (!content || finishReason === "error") return;
      try {
        await saveBrief(user.id, {
          date,
          content,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn("Stockwatcher brief save failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }
    },
    onError: ({ error }) => {
      console.warn("Stockwatcher brief stream failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    },
  });
  result.consumeStream();

  return createTextStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toTextStream({ stream: result.stream }),
  });
}
