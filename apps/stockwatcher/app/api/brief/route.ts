import { randomUUID } from "node:crypto";
import {
  createTextStreamResponse,
  type StepResult,
  streamText,
  type ToolSet,
  toTextStream,
} from "ai";
import { z } from "zod";
import { briefDataPack } from "@/lib/ai/brief";
import { aiEnabled, briefModel } from "@/lib/ai/config";
import { briefInstructions } from "@/lib/ai/prompt";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { release, reserve } from "@/lib/billing/credits";
import { meter } from "@/lib/billing/meter";
import { readWorkspace } from "@/lib/db";
import { getBrief, listMemories, saveBrief } from "@/lib/memory";

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
  const reservation = await reserve(user);
  if (!reservation.ok)
    return json(
      {
        error: "You are out of credits.",
        code: "out_of_credits",
        balance: reservation.balance,
      },
      402,
    );

  let pack: string;
  try {
    const [workspace, memories] = await Promise.all([
      readWorkspace(user.id),
      listMemories(user.id).catch(() => []),
    ]);
    pack = await briefDataPack(workspace.data, memories);
  } catch (error) {
    await release(reservation).catch(() => undefined);
    throw error;
  }

  const ref = `brief:${randomUUID()}`;
  const finished: StepResult<ToolSet>[] = [];
  let settled = false;
  // onEnd, onAbort and a stream that dies without either all land here once.
  const settleOnce = (steps: ReadonlyArray<StepResult<ToolSet>>) => {
    if (settled) return;
    settled = true;
    void meter(user, reservation, steps, {
      ref,
      model: steps[0]?.model.modelId ?? null,
      source: "brief",
    });
  };

  const result = streamText({
    model: briefModel(),
    instructions: briefInstructions({ name: user.name, date }),
    prompt: `Data pack (JSON):\n${pack}\n\nWrite the brief for ${date}.`,
    maxOutputTokens: 1200,
    timeout: { totalMs: 80_000 },
    onStepEnd: (step) => {
      finished.push(step);
    },
    onAbort: ({ steps }) => settleOnce(steps),
    onEnd: async ({ text, finishReason, steps }) => {
      settleOnce(steps);
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
  void Promise.resolve(result.consumeStream())
    .catch(() => undefined)
    .then(() => setTimeout(() => settleOnce(finished), 1_000));

  return createTextStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toTextStream({ stream: result.stream }),
  });
}
