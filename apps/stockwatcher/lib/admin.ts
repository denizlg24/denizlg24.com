import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { currentUser, isAdmin } from "./auth";
import { store } from "./db";
import { type RedactSubject, redactText, redactValue } from "./redact";

export const promptCap = 4_000;
export const replyCap = 8_000;
export const errorCap = 2_000;

const toolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  ms: z.number().optional(),
  pending: z.boolean().optional(),
});
export type ToolCallRecord = z.infer<typeof toolCallSchema>;

export type ChatRunInput = {
  id: string;
  userId: string;
  threadId: string;
  messageId: string;
  startedAt: string;
  durationMs: number;
  model: string | null;
  finishReason: string | null;
  steps: number;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCalls: ToolCallRecord[];
  error: string | null;
  prompt: string | null;
  reply: string | null;
  context: object | null;
  subject: RedactSubject;
};

export type ChatRun = Omit<
  ChatRunInput,
  "messageId" | "context" | "subject"
> & {
  messageId: string | null;
  context: unknown;
};

export type RunWithUser = ChatRun & { userName: string | null };

export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  demo: boolean;
  lastSeen: string | null;
  lastActive: string | null;
  threads: number;
  runs: number;
  errors: number;
};

export type AdminThread = {
  id: string;
  title: string;
  updatedAt: string;
  messages: number;
  runs: number;
  errors: number;
};

export type Overview = {
  users: number;
  threads: number;
  runs: number;
  errors: number;
  avgDurationMs: number | null;
  avgTokens: number | null;
};

export type WorkspaceSnapshot = {
  exists: boolean;
  books: number;
  brokerBooks: number;
  trades: number;
  watchlists: number;
  watchedSymbols: number;
  alerts: number;
  enabledAlerts: number;
  notes: number;
  memories: number;
  channels: number;
  broker: {
    status: string;
    error: string | null;
    syncedAt: string | null;
  } | null;
};

export async function requireAdmin() {
  const user = await currentUser();
  if (!user || !isAdmin(user)) notFound();
  return user;
}

export const clip = (text: string, cap: number) =>
  text.length > cap ? `${text.slice(0, cap - 1)}…` : text;

const iso = (value: unknown) =>
  value instanceof Date
    ? value.toISOString()
    : value == null
      ? null
      : String(value);
const text = (value: unknown) => (value == null ? null : String(value));
const count = (value: unknown) => Number(value ?? 0) || 0;
const numberOrNull = (value: unknown) =>
  value == null || Number.isNaN(Number(value)) ? null : Number(value);

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toolCalls(value: unknown): ToolCallRecord[] {
  const parsed = toolCallSchema.array().safeParse(parseJson(value));
  return parsed.success ? parsed.data : [];
}

const redactCalls = (calls: ToolCallRecord[], subject?: RedactSubject) =>
  calls.map((call) =>
    call.error ? { ...call, error: redactText(call.error, subject) } : call,
  );

const redactNullable = (value: string | null) =>
  value === null ? null : redactText(value);

const latest = (...values: Array<string | null>) =>
  values.reduce<string | null>(
    (best, value) => (value && (!best || value > best) ? value : best),
    null,
  );

type RunRow = Record<string, unknown>;

function toRun(row: RunRow): RunWithUser {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    messageId: text(row.message_id),
    startedAt: iso(row.started_at) ?? "",
    durationMs: count(row.duration_ms),
    model: text(row.model),
    finishReason: text(row.finish_reason),
    steps: count(row.steps),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    toolCalls: redactCalls(toolCalls(row.tool_calls)),
    error: redactNullable(text(row.error)),
    prompt: redactNullable(text(row.prompt)),
    reply: redactNullable(text(row.reply)),
    context: redactValue(parseJson(row.context)),
    userName: text(row.user_name),
  };
}

export async function recordRun(run: ChatRunInput): Promise<void> {
  const s = await store();
  const scrub = (value: string | null, cap: number) =>
    value === null ? null : clip(redactText(value, run.subject), cap);
  const prompt = scrub(run.prompt, promptCap);
  const reply = scrub(run.reply, replyCap);
  const error = scrub(run.error, errorCap);
  const calls = redactCalls(run.toolCalls, run.subject);
  const context = run.context ? redactValue(run.context, run.subject) : null;
  if (s.kind === "pg") {
    await s.sql`
      INSERT INTO stockwatcher_chat_runs (
        id, user_id, thread_id, message_id, started_at, duration_ms, model,
        finish_reason, steps, input_tokens, output_tokens, tool_calls, error,
        prompt, reply, context
      ) VALUES (
        ${run.id}, ${run.userId}, ${run.threadId}, ${run.messageId},
        ${run.startedAt}, ${run.durationMs}, ${run.model}, ${run.finishReason},
        ${run.steps}, ${run.inputTokens}, ${run.outputTokens},
        ${s.sql.json(calls)}, ${error}, ${prompt}, ${reply},
        ${context ? s.sql.json(context) : null}
      ) ON CONFLICT (id) DO NOTHING`;
    return;
  }
  s.db
    .prepare(
      `INSERT OR IGNORE INTO chat_runs (
        id, user_id, thread_id, message_id, started_at, duration_ms, model,
        finish_reason, steps, input_tokens, output_tokens, tool_calls, error,
        prompt, reply, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.userId,
      run.threadId,
      run.messageId,
      run.startedAt,
      run.durationMs,
      run.model,
      run.finishReason,
      run.steps,
      run.inputTokens,
      run.outputTokens,
      JSON.stringify(calls),
      error,
      prompt,
      reply,
      context ? JSON.stringify(context) : null,
    );
}

export async function overview(
  days: number,
): Promise<Overview & { since: string }> {
  const s = await store();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  if (s.kind === "pg") {
    const [users] = await s.sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT id FROM stockwatcher_users WHERE id NOT LIKE 'demo:%'
        UNION SELECT user_id FROM stockwatcher_threads
        UNION SELECT user_id FROM stockwatcher_chat_runs
      ) ids`;
    const [threads] = await s.sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM stockwatcher_threads`;
    const [runs] = await s.sql<RunRow[]>`
      SELECT COUNT(*)::int AS runs,
        COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
        AVG(duration_ms) AS avg_duration,
        AVG(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS avg_tokens
      FROM stockwatcher_chat_runs WHERE started_at >= ${from}`;
    return {
      since: from,
      users: count(users?.total),
      threads: count(threads?.total),
      runs: count(runs?.runs),
      errors: count(runs?.errors),
      avgDurationMs: numberOrNull(runs?.avg_duration),
      avgTokens: numberOrNull(runs?.avg_tokens),
    };
  }
  const users = s.db
    .prepare(
      `SELECT COUNT(*) AS total FROM (
        SELECT id FROM users WHERE id NOT LIKE 'demo:%'
        UNION SELECT user_id FROM threads
        UNION SELECT user_id FROM chat_runs
      )`,
    )
    .get();
  const threads = s.db.prepare("SELECT COUNT(*) AS total FROM threads").get();
  const runs = s.db
    .prepare(
      `SELECT COUNT(*) AS runs,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
        AVG(duration_ms) AS avg_duration,
        AVG(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS avg_tokens
      FROM chat_runs WHERE started_at >= ?`,
    )
    .get(from);
  return {
    since: from,
    users: count(users?.total),
    threads: count(threads?.total),
    runs: count(runs?.runs),
    errors: count(runs?.errors),
    avgDurationMs: numberOrNull(runs?.avg_duration),
    avgTokens: numberOrNull(runs?.avg_tokens),
  };
}

function toUser(row: RunRow): AdminUser {
  const id = String(row.id);
  const lastSeen = iso(row.last_seen);
  return {
    id,
    name: text(row.name),
    email: text(row.email),
    demo: id.startsWith("demo:"),
    lastSeen,
    lastActive: latest(lastSeen, iso(row.last_thread), iso(row.last_run)),
    threads: count(row.threads),
    runs: count(row.runs),
    errors: count(row.errors),
  };
}

const userQuery = `
  WITH t AS (
    SELECT user_id, COUNT(*) AS threads, MAX(updated_at) AS last_thread
    FROM {threads} GROUP BY user_id
  ), r AS (
    SELECT user_id, COUNT(*) AS runs,
      SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
      MAX(started_at) AS last_run
    FROM {runs} GROUP BY user_id
  ), ids AS (
    SELECT id AS user_id FROM {users}
    UNION SELECT user_id FROM t
    UNION SELECT user_id FROM r
  )
  SELECT ids.user_id AS id, u.name, u.email, u.last_seen,
    COALESCE(t.threads, 0) AS threads, t.last_thread,
    COALESCE(r.runs, 0) AS runs, COALESCE(r.errors, 0) AS errors, r.last_run
  FROM ids
  LEFT JOIN {users} u ON u.id = ids.user_id
  LEFT JOIN t ON t.user_id = ids.user_id
  LEFT JOIN r ON r.user_id = ids.user_id`;

const tableNames = (pg: boolean) => (query: string) =>
  query
    .replaceAll("{threads}", pg ? "stockwatcher_threads" : "threads")
    .replaceAll("{runs}", pg ? "stockwatcher_chat_runs" : "chat_runs")
    .replaceAll("{users}", pg ? "stockwatcher_users" : "users");

/**
 * Everyone with a profile, a thread, or a run. Preview identities are new on
 * every sign-in, so those without any assistant activity are left out.
 */
export async function listUsers(): Promise<{
  users: AdminUser[];
  hiddenPreview: number;
}> {
  const s = await store();
  const query = tableNames(s.kind === "pg")(userQuery);
  const rows =
    s.kind === "pg"
      ? await s.sql.unsafe<RunRow[]>(query)
      : s.db.prepare(query).all();
  const all = rows.map(toUser);
  const users = all
    .filter((user) => !user.demo || user.threads > 0 || user.runs > 0)
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  return { users, hiddenPreview: all.length - users.length };
}

export async function getUser(id: string): Promise<AdminUser | null> {
  const s = await store();
  const query = `${tableNames(s.kind === "pg")(userQuery)} WHERE ids.user_id = ${s.kind === "pg" ? "$1" : "?"}`;
  const [row] =
    s.kind === "pg"
      ? await s.sql.unsafe<RunRow[]>(query, [id])
      : s.db.prepare(query).all(id);
  if (row) return toUser(row);
  const workspace =
    s.kind === "pg"
      ? (
          await s.sql<RunRow[]>`
            SELECT user_id FROM stockwatcher_workspaces WHERE user_id = ${id}`
        )[0]
      : s.db
          .prepare("SELECT user_id FROM workspaces WHERE user_id = ?")
          .get(id);
  return workspace
    ? {
        id,
        name: null,
        email: null,
        demo: id.startsWith("demo:"),
        lastSeen: null,
        lastActive: null,
        threads: 0,
        runs: 0,
        errors: 0,
      }
    : null;
}

export async function listRuns(filter: {
  userId?: string;
  threadId?: string;
  limit: number;
}): Promise<RunWithUser[]> {
  const s = await store();
  const userId = filter.userId ?? null;
  const threadId = filter.threadId ?? null;
  if (s.kind === "pg") {
    const rows = await s.sql<RunRow[]>`
      SELECT r.*, u.name AS user_name FROM stockwatcher_chat_runs r
      LEFT JOIN stockwatcher_users u ON u.id = r.user_id
      WHERE (${userId}::text IS NULL OR r.user_id = ${userId})
        AND (${threadId}::text IS NULL OR r.thread_id = ${threadId})
      ORDER BY r.started_at DESC LIMIT ${filter.limit}`;
    return rows.map(toRun);
  }
  return s.db
    .prepare(
      `SELECT r.*, u.name AS user_name FROM chat_runs r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE (? IS NULL OR r.user_id = ?) AND (? IS NULL OR r.thread_id = ?)
      ORDER BY r.started_at DESC LIMIT ?`,
    )
    .all(userId, userId, threadId, threadId, filter.limit)
    .map(toRun);
}

export async function listUserThreads(userId: string): Promise<AdminThread[]> {
  const s = await store();
  // saveThread stores the pg array as a JSON string scalar inside jsonb.
  const rows =
    s.kind === "pg"
      ? await s.sql<RunRow[]>`
          SELECT t.id, t.title, t.updated_at,
            jsonb_array_length(CASE jsonb_typeof(t.messages)
              WHEN 'string' THEN (t.messages #>> '{}')::jsonb
              ELSE t.messages END) AS messages,
            r.runs, r.errors
          FROM stockwatcher_threads t
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS runs, COUNT(error)::int AS errors
            FROM stockwatcher_chat_runs
            WHERE user_id = t.user_id AND thread_id = t.id
          ) r ON true
          WHERE t.user_id = ${userId}
          ORDER BY t.updated_at DESC`
      : s.db
          .prepare(
            `SELECT t.id, t.title, t.updated_at,
              json_array_length(t.messages) AS messages,
              (SELECT COUNT(*) FROM chat_runs r
                WHERE r.user_id = t.user_id AND r.thread_id = t.id) AS runs,
              (SELECT COUNT(r.error) FROM chat_runs r
                WHERE r.user_id = t.user_id AND r.thread_id = t.id) AS errors
            FROM threads t WHERE t.user_id = ?
            ORDER BY t.updated_at DESC`,
          )
          .all(userId);
  return rows.map((row) => ({
    id: String(row.id),
    title: redactText(String(row.title)),
    updatedAt: iso(row.updated_at) ?? "",
    messages: count(row.messages),
    runs: count(row.runs),
    errors: count(row.errors),
  }));
}

const looseList = z.array(z.looseObject({})).catch([]);
const snapshotSchema = z.looseObject({
  books: z.array(z.looseObject({ broker: z.unknown().optional() })).catch([]),
  trades: looseList,
  watchlists: z
    .array(z.looseObject({ symbols: z.array(z.unknown()).catch([]) }))
    .catch([]),
  alerts: z.array(z.looseObject({ enabled: z.unknown().optional() })).catch([]),
  notes: looseList,
});

export async function workspaceSnapshot(
  userId: string,
): Promise<WorkspaceSnapshot> {
  const s = await store();
  let data: unknown = null;
  let memories = 0;
  let channels = 0;
  let link: RunRow | undefined;
  if (s.kind === "pg") {
    const [workspace] = await s.sql<RunRow[]>`
      SELECT data FROM stockwatcher_workspaces WHERE user_id = ${userId}`;
    data = parseJson(workspace?.data);
    const [counts] = await s.sql<RunRow[]>`
      SELECT
        (SELECT COUNT(*)::int FROM stockwatcher_memories WHERE user_id = ${userId}) AS memories,
        (SELECT COUNT(*)::int FROM stockwatcher_alert_channels WHERE user_id = ${userId}) AS channels`;
    memories = count(counts?.memories);
    channels = count(counts?.channels);
    [link] = await s.sql<RunRow[]>`
      SELECT status, error, synced_at FROM stockwatcher_broker_links
      WHERE user_id = ${userId} AND provider = 'ibkr'`;
  } else {
    data = parseJson(
      s.db.prepare("SELECT data FROM workspaces WHERE user_id = ?").get(userId)
        ?.data,
    );
    const counts = s.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM memories WHERE user_id = ?) AS memories,
          (SELECT COUNT(*) FROM alert_channels WHERE user_id = ?) AS channels`,
      )
      .get(userId, userId);
    memories = count(counts?.memories);
    channels = count(counts?.channels);
    link = s.db
      .prepare(
        "SELECT status, error, synced_at FROM broker_links WHERE user_id = ? AND provider = 'ibkr'",
      )
      .get(userId);
  }
  const parsed = snapshotSchema.safeParse(data);
  const workspace = parsed.success ? parsed.data : null;
  return {
    exists: workspace !== null,
    books: workspace?.books.length ?? 0,
    brokerBooks: workspace?.books.filter((book) => book.broker).length ?? 0,
    trades: workspace?.trades.length ?? 0,
    watchlists: workspace?.watchlists.length ?? 0,
    watchedSymbols:
      workspace?.watchlists.reduce(
        (sum, list) => sum + list.symbols.length,
        0,
      ) ?? 0,
    alerts: workspace?.alerts.length ?? 0,
    enabledAlerts:
      workspace?.alerts.filter((alert) => alert.enabled === true).length ?? 0,
    notes: workspace?.notes.length ?? 0,
    memories,
    channels,
    broker: link
      ? {
          status: String(link.status),
          error: text(link.error),
          syncedAt: iso(link.synced_at),
        }
      : null,
  };
}

export const userSlug = (id: string) => Buffer.from(id).toString("base64url");

export function userFromSlug(slug: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,700}$/.test(slug)) return null;
  const id = Buffer.from(slug, "base64url").toString("utf8");
  return id && userSlug(id) === slug ? id : null;
}

export type RunStatus = "error" | "warn" | "ok";

export const runStatus = (run: ChatRun): RunStatus =>
  run.error ? "error" : run.toolCalls.some((call) => !call.ok) ? "warn" : "ok";
