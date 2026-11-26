import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { type Identity, store } from "@/lib/db";

export const MC_PER_CREDIT = 1000;
const MC_PER_USD = 100 * MC_PER_CREDIT;
const HOLD_MINUTES = 10;

const numberEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const creditConfig = () => ({
  markup: numberEnv("CREDIT_MARKUP", 2),
  freeMonthly: Math.round(
    numberEnv("FREE_CREDITS_MONTHLY", 100) * MC_PER_CREDIT,
  ),
  reserve: Math.round(numberEnv("CHAT_RESERVE_CREDITS", 5) * MC_PER_CREDIT),
  floor: Math.round(numberEnv("CREDIT_FLOOR", 1) * MC_PER_CREDIT),
});

export const billingEnabled = () =>
  process.env.BILLING === "1" && Boolean(process.env.DATABASE_URL);

const listEnv = (name: string) =>
  new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

export function unmetered(identity: Pick<Identity, "id">) {
  const subjects = listEnv("STOCKWATCHER_UNMETERED_SUBJECTS");
  if (!subjects.size) return false;
  if (subjects.has(identity.id)) return true;
  const split = identity.id.lastIndexOf("|");
  return split >= 0 && subjects.has(identity.id.slice(split + 1));
}

export const credits = (mc: number) => mc / MC_PER_CREDIT;

export const chargeFor = (costUsd: number, markup = creditConfig().markup) =>
  Math.max(0, Math.ceil(costUsd * markup * MC_PER_USD));

export const period = (date = new Date()) => date.toISOString().slice(0, 7);

export function nextReset(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  ).toISOString();
}

async function pg() {
  const db = await store();
  if (db.kind !== "pg") throw new Error("Credits need DATABASE_URL.");
  return db.sql;
}

type AccountRow = {
  free_mc: string | number;
  paid_mc: string | number;
  free_period: string;
};

async function lockAccount(sql: postgres.TransactionSql, userId: string) {
  const now = new Date();
  const config = creditConfig();
  await sql`
    INSERT INTO stockwatcher_credit_accounts (user_id, free_mc, paid_mc, free_period, updated_at)
    VALUES (${userId}, 0, 0, '', ${now})
    ON CONFLICT (user_id) DO NOTHING`;
  const [row] = await sql<AccountRow[]>`
    SELECT free_mc, paid_mc, free_period FROM stockwatcher_credit_accounts
    WHERE user_id = ${userId} FOR UPDATE`;
  let free = Number(row.free_mc);
  const paid = Number(row.paid_mc);
  const current = period(now);
  if (row.free_period !== current) {
    const delta = config.freeMonthly - free;
    free = config.freeMonthly;
    await sql`
      UPDATE stockwatcher_credit_accounts
      SET free_mc = ${free}, free_period = ${current}, updated_at = ${now}
      WHERE user_id = ${userId}`;
    await sql`
      INSERT INTO stockwatcher_credit_ledger
        (id, user_id, kind, amount_mc, free_mc, paid_mc, ref, meta, created_at)
      VALUES (${randomUUID()}, ${userId}, 'free_reset', ${delta}, ${delta}, 0,
        ${`free:${userId}:${current}`}, ${sql.json({ period: current })}, ${now})
      ON CONFLICT (ref) DO NOTHING`;
  }
  await sql`DELETE FROM stockwatcher_credit_holds WHERE user_id = ${userId} AND expires_at <= ${now}`;
  const [{ held }] = await sql<{ held: string | null }[]>`
    SELECT COALESCE(SUM(amount_mc), 0) AS held FROM stockwatcher_credit_holds
    WHERE user_id = ${userId}`;
  return { free, paid, held: Number(held ?? 0) };
}

export type Balance = {
  free: number;
  paid: number;
  held: number;
  available: number;
  resetsAt: string;
  freeMonthly: number;
};

const toBalance = (state: { free: number; paid: number; held: number }) => ({
  free: credits(state.free),
  paid: credits(state.paid),
  held: credits(state.held),
  available: credits(state.free + state.paid - state.held),
  resetsAt: nextReset(),
  freeMonthly: credits(creditConfig().freeMonthly),
});

export async function balance(userId: string): Promise<Balance> {
  const sql = await pg();
  return sql.begin(async (tx) => toBalance(await lockAccount(tx, userId)));
}

export type Reservation =
  | { ok: true; holdId: string | null; metered: boolean }
  | { ok: false; balance: Balance };

export async function reserve(
  user: Pick<Identity, "id" | "demo">,
  amountMc = creditConfig().reserve,
): Promise<Reservation> {
  if (!billingEnabled() || user.demo)
    return { ok: true, holdId: null, metered: false };
  if (unmetered(user)) return { ok: true, holdId: null, metered: false };
  const sql = await pg();
  return sql.begin(async (tx): Promise<Reservation> => {
    const state = await lockAccount(tx, user.id);
    const available = state.free + state.paid - state.held;
    if (available < creditConfig().floor)
      return { ok: false, balance: toBalance(state) };
    const holdId = randomUUID();
    const expires = new Date(Date.now() + HOLD_MINUTES * 60_000);
    await tx`
      INSERT INTO stockwatcher_credit_holds (id, user_id, amount_mc, expires_at)
      VALUES (${holdId}, ${user.id}, ${Math.min(amountMc, available)}, ${expires})`;
    return { ok: true, holdId, metered: true };
  });
}

export type Usage = {
  ref: string;
  costUsd: number;
  threadId?: string | null;
  messageId?: string | null;
  model?: string | null;
  source: "chat" | "brief" | "supply-chain";
};

/** Settles a reservation against the actual model cost. Returns credits charged. */
export async function settle(
  user: Pick<Identity, "id" | "demo">,
  reservation: Extract<Reservation, { ok: true }>,
  usage: Usage,
): Promise<number> {
  if (!billingEnabled() || user.demo) return 0;
  const sql = await pg();
  const charge = chargeFor(usage.costUsd);
  const metered = reservation.metered;
  return sql.begin(async (tx) => {
    const state = await lockAccount(tx, user.id);
    if (reservation.holdId)
      await tx`DELETE FROM stockwatcher_credit_holds WHERE id = ${reservation.holdId}`;
    const fromFree = metered ? Math.min(Math.max(state.free, 0), charge) : 0;
    const fromPaid = metered ? charge - fromFree : 0;
    const now = new Date();
    const inserted = await tx`
      INSERT INTO stockwatcher_credit_ledger
        (id, user_id, kind, amount_mc, free_mc, paid_mc, ref, thread_id,
         message_id, model, cost_usd, meta, created_at)
      VALUES (${randomUUID()}, ${user.id}, 'usage', ${-(fromFree + fromPaid)},
        ${-fromFree}, ${-fromPaid}, ${usage.ref}, ${usage.threadId ?? null},
        ${usage.messageId ?? null}, ${usage.model ?? null}, ${usage.costUsd},
        ${tx.json({ source: usage.source, metered, charge })}, ${now})
      ON CONFLICT (ref) DO NOTHING`;
    if (inserted.count === 1 && metered)
      await tx`
        UPDATE stockwatcher_credit_accounts
        SET free_mc = free_mc - ${fromFree}, paid_mc = paid_mc - ${fromPaid},
          updated_at = ${now}
        WHERE user_id = ${user.id}`;
    return credits(charge);
  });
}

export async function release(reservation: Extract<Reservation, { ok: true }>) {
  if (!reservation.holdId) return;
  const sql = await pg();
  await sql`DELETE FROM stockwatcher_credit_holds WHERE id = ${reservation.holdId}`;
}

/** Adds (or with a negative amount, removes) paid credits once per ref. */
export async function adjustPaid(input: {
  userId: string;
  amountMc: number;
  kind: "purchase" | "refund" | "adjust";
  ref: string;
  meta: Record<string, string | number | boolean | null>;
}) {
  const sql = await pg();
  return sql.begin(async (tx) => {
    await lockAccount(tx, input.userId);
    const now = new Date();
    const inserted = await tx`
      INSERT INTO stockwatcher_credit_ledger
        (id, user_id, kind, amount_mc, free_mc, paid_mc, ref, meta, created_at)
      VALUES (${randomUUID()}, ${input.userId}, ${input.kind}, ${input.amountMc},
        0, ${input.amountMc}, ${input.ref}, ${tx.json(input.meta)}, ${now})
      ON CONFLICT (ref) DO NOTHING`;
    if (inserted.count !== 1) return false;
    await tx`
      UPDATE stockwatcher_credit_accounts
      SET paid_mc = paid_mc + ${input.amountMc}, updated_at = ${now}
      WHERE user_id = ${input.userId}`;
    return true;
  });
}

export async function refundedFor(orderId: string) {
  const sql = await pg();
  const [row] = await sql<{ total: string | null }[]>`
    SELECT COALESCE(SUM(-amount_mc), 0) AS total FROM stockwatcher_credit_ledger
    WHERE kind = 'refund' AND meta->>'orderId' = ${orderId}`;
  return Number(row?.total ?? 0);
}

export type LedgerEntry = {
  id: string;
  kind: string;
  credits: number;
  threadId: string | null;
  model: string | null;
  source: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
};

export async function ledger(userId: string, limit = 100) {
  const sql = await pg();
  const rows = await sql<
    {
      id: string;
      kind: string;
      amount_mc: string;
      thread_id: string | null;
      model: string | null;
      meta: Record<string, unknown>;
      created_at: Date;
    }[]
  >`
    SELECT id, kind, amount_mc, thread_id, model, meta, created_at
    FROM stockwatcher_credit_ledger WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(
    (row): LedgerEntry => ({
      id: row.id,
      kind: row.kind,
      credits: credits(Number(row.amount_mc)),
      threadId: row.thread_id,
      model: row.model,
      source: typeof row.meta.source === "string" ? row.meta.source : null,
      createdAt: row.created_at.toISOString(),
      meta: row.meta,
    }),
  );
}

export async function usageByThread(userId: string, threadIds: string[]) {
  if (!threadIds.length || !billingEnabled()) return new Map<string, number>();
  const sql = await pg();
  const rows = await sql<{ thread_id: string; spent: string }[]>`
    SELECT thread_id, SUM(-amount_mc) AS spent FROM stockwatcher_credit_ledger
    WHERE user_id = ${userId} AND kind = 'usage' AND thread_id IN ${sql(threadIds)}
    GROUP BY thread_id`;
  return new Map(
    rows.map((row) => [row.thread_id, credits(Number(row.spent))]),
  );
}

export async function usageByDay(userId: string, days = 30) {
  const sql = await pg();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await sql<{ day: string; spent: string; runs: string }[]>`
    SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      SUM(-amount_mc) AS spent, COUNT(*) AS runs
    FROM stockwatcher_credit_ledger
    WHERE user_id = ${userId} AND kind = 'usage' AND created_at >= ${since}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((row) => ({
    day: row.day,
    credits: credits(Number(row.spent)),
    runs: Number(row.runs),
  }));
}

/** Sums `providerMetadata.gateway.cost` (USD, decimal string) over steps. */
export function gatewayCost(
  steps: ReadonlyArray<{
    providerMetadata?: Record<string, Record<string, unknown>> | undefined;
  }>,
) {
  let total = 0;
  let missing = 0;
  for (const step of steps) {
    const cost = Number(step.providerMetadata?.gateway?.cost);
    if (Number.isFinite(cost)) total += cost;
    else missing++;
  }
  return { costUsd: total, missing };
}
