/**
 * Runs one routine for a throwaway user against DATABASE_URL and the real AI
 * Gateway (one short model turn, a few cents): the monitor must claim it, run
 * it, save the thread, log the event and charge the ledger, and a second check
 * must not run the same slot again. Cleans up its user afterwards.
 *
 *   bun --env-file=.env.local scripts/routines-e2e.ts
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

Bun.plugin({
  name: "server-only",
  setup(build) {
    build.module("server-only", () => ({ contents: "", loader: "js" }));
  },
});

const { readWorkspace } = await import("@/lib/db");
const { getThread, updateWorkspace } = await import("@/lib/memory");
const { routineSchema } = await import("@/lib/models");
const { monitorRoutines } = await import("@/lib/routine-runner");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");
const sql = postgres(url, { max: 2, onnotice: () => {} });
const user = `e2e:${randomUUID()}`;
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

try {
  await readWorkspace(user);
  await sql`
    INSERT INTO stockwatcher_users (id, name, email, last_seen)
    VALUES (${user}, 'Routine E2E', NULL, ${new Date().toISOString()})`;
  const bookId = randomUUID();
  const routine = routineSchema.parse({
    id: randomUUID(),
    name: "Monthly ETF check",
    prompt:
      "Call getPortfolio once. In under 80 words, name my holdings and which one is down most today. No tables.",
    schedule: { frequency: "daily", hour: 0, timeZone: "UTC" },
    enabled: true,
    channels: [],
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  });
  await updateWorkspace(user, (workspace) => ({
    ...workspace,
    books: [{ id: bookId, name: "E2E" }],
    trades: [
      {
        id: randomUUID(),
        bookId,
        symbol: "VWCE.DE",
        side: "buy",
        quantity: 10,
        price: 120,
        fees: 0,
        currency: "EUR",
        date: "2025-01-02",
      },
    ],
    routines: [routine],
  }));

  const started = Date.now();
  await monitorRoutines();
  console.log(`run took ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const after = (await readWorkspace(user)).data.routines[0];
  check(after?.lastRun != null, "the run was claimed");
  check(after?.lastError == null, `no error (${after?.lastError ?? "none"})`);
  check(after?.runCount === 1, "runCount is 1");
  check(Boolean(after?.lastSummary), `summary: ${after?.lastSummary ?? "—"}`);
  const thread = after?.lastThreadId
    ? await getThread(user, after.lastThreadId)
    : null;
  check(thread?.messages.length === 2, "thread saved with question and answer");
  const answer = thread?.messages[1];
  check(
    answer?.parts.some((part) => part.type === "tool-getPortfolio") ?? false,
    "the answer called getPortfolio",
  );
  const log = (await readWorkspace(user)).data.alertLog;
  check(log[0]?.alertId === routine.id, "an alert-log event was written");
  const ledger = await sql<{ meta: { source?: string } }[]>`
    SELECT meta FROM stockwatcher_credit_ledger
    WHERE user_id = ${user} AND kind = 'usage'`;
  if (process.env.BILLING === "1")
    check(
      ledger.some((row) => row.meta.source === "routine"),
      "the run was charged as source routine",
    );

  await monitorRoutines();
  const again = (await readWorkspace(user)).data.routines[0];
  check(again?.runCount === 1, "a second check does not rerun the slot");
} finally {
  for (const table of [
    "stockwatcher_threads",
    "stockwatcher_workspaces",
    "stockwatcher_users",
    "stockwatcher_credit_holds",
    "stockwatcher_credit_ledger",
    "stockwatcher_credit_accounts",
  ])
    await sql`DELETE FROM ${sql(table)} WHERE ${sql(table === "stockwatcher_users" ? "id" : "user_id")} = ${user}`.catch(
      () => undefined,
    );
  await sql.end({ timeout: 5 });
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("routines e2e passed");
process.exit(0);
