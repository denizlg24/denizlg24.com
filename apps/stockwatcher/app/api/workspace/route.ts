import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import {
  clearSignalErrors,
  deleteSignalRuntime,
  readSignalRuntime,
  readWorkspace,
  readWorkspaceView,
  saveWorkspace,
  withRuntimeState,
} from "@/lib/db";
import { workspaceSchema } from "@/lib/models";
import { checkTrades } from "@/lib/portfolio";

const update = z.object({
  revision: z.number().int().min(0),
  data: workspaceSchema,
});

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to open your workspace." }, 401);
  return json(await readWorkspaceView(user.id));
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
  // Broker-synced books and their positions are server-owned.
  const priorBroker = new Map(
    current.data.books.flatMap((book) =>
      book.broker ? [[book.id, book.broker] as const] : [],
    ),
  );
  data.books = data.books.map((book) => {
    const broker = priorBroker.get(book.id);
    return broker
      ? { id: book.id, name: book.name, broker }
      : { id: book.id, name: book.name };
  });
  const synced = new Set(
    data.books.filter((book) => book.broker).map((book) => book.id),
  );
  data.trades = [
    ...data.trades.filter((trade) => !synced.has(trade.bookId)),
    ...current.data.trades.filter((trade) => synced.has(trade.bookId)),
  ];
  try {
    for (const collection of [
      data.watchlists,
      data.books,
      data.trades,
      data.notes,
      data.alerts,
      data.signals,
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
      prior.metric === alert.metric &&
      prior.direction === alert.direction &&
      prior.target === alert.target &&
      prior.reference === alert.reference;
    return {
      ...alert,
      lastTriggered: sameRule ? prior.lastTriggered : null,
      triggeredPrice: sameRule ? prior.triggeredPrice : null,
      triggerCount: sameRule ? prior.triggerCount : 0,
      primed: sameRule && alert.enabled === prior.enabled ? prior.primed : true,
    };
  });
  // Signals are created by the assistant; here they can only be toggled or removed.
  data.signals = current.data.signals.flatMap((prior) => {
    const sent = data.signals.find((item) => item.id === prior.id);
    if (!sent) return [];
    if (sent.enabled === prior.enabled) return [prior];
    return [
      sent.enabled
        ? { ...prior, enabled: true, primed: true }
        : { ...prior, enabled: false },
    ];
  });
  // Routines too; resuming one skips the slots it missed while paused.
  const resumedAt = new Date().toISOString();
  data.routines = current.data.routines.flatMap((prior) => {
    const sent = data.routines.find((item) => item.id === prior.id);
    if (!sent) return [];
    if (sent.enabled === prior.enabled) return [prior];
    return [
      sent.enabled
        ? { ...prior, enabled: true, resumedAt }
        : { ...prior, enabled: false },
    ];
  });
  data.alertLog = current.data.alertLog;
  const removed = current.data.signals
    .filter((prior) => !data.signals.some((item) => item.id === prior.id))
    .map((prior) => prior.id);
  const rearmed = data.signals
    .filter((item) =>
      current.data.signals.some(
        (prior) => prior.id === item.id && !prior.enabled && item.enabled,
      ),
    )
    .map((item) => item.id);
  if (!(await saveWorkspace(user.id, revision, data)))
    return json(
      {
        error:
          "Workspace changed in another tab. Your view was refreshed. Try saving again.",
      },
      409,
    );
  await deleteSignalRuntime(user.id, removed);
  await clearSignalErrors(user.id, rearmed);
  return json(
    withRuntimeState(
      { revision: revision + 1, data },
      await readSignalRuntime(user.id),
    ),
  );
}
