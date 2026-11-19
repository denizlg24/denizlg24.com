import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace, saveWorkspace } from "@/lib/db";
import { workspaceSchema } from "@/lib/models";
import { checkTrades } from "@/lib/portfolio";

const update = z.object({
  revision: z.number().int().min(0),
  data: workspaceSchema,
});

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to open your workspace." }, 401);
  return json(await readWorkspace(user.id));
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to save your workspace." }, 401);
  const body = await request.text();
  if (Buffer.byteLength(body) > 8_000_000)
    return json({ error: "Workspace exceeds 8 MB." }, 413);
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = update.safeParse(input);
  if (!parsed.success)
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid workspace." },
      400,
    );
  const { revision, data } = parsed.data;
  const current = await readWorkspace(user.id);
  if (revision !== current.revision)
    return json(
      {
        error:
          "Workspace changed in another tab. Your view was refreshed. Try saving again.",
      },
      409,
    );
  try {
    for (const collection of [
      data.watchlists,
      data.books,
      data.trades,
      data.notes,
      data.alerts,
      data.requests,
    ]) {
      if (new Set(collection.map((item) => item.id)).size !== collection.length)
        throw new Error("Duplicate records are not allowed.");
    }
    checkTrades(data.trades, data.books);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Could not save workspace.",
      },
      400,
    );
  }
  // Alert events are server-owned. Editing a target must reset its event.
  data.alerts = data.alerts.map((alert) => {
    const prior = current.data.alerts.find((item) => item.id === alert.id);
    const sameRule =
      prior &&
      prior.symbol === alert.symbol &&
      prior.direction === alert.direction &&
      prior.target === alert.target;
    return {
      ...alert,
      lastTriggered: sameRule ? prior.lastTriggered : null,
      triggeredPrice: sameRule ? prior.triggeredPrice : null,
    };
  });
  if (!(await saveWorkspace(user.id, revision, data)))
    return json(
      {
        error:
          "Workspace changed in another tab. Your view was refreshed. Try saving again.",
      },
      409,
    );
  return json({ revision: revision + 1, data });
}
