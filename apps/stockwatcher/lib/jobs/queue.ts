import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { store } from "../db";

/** NOTIFY channel: a job was queued (payload: kind) or finished (payload: id). */
export const queuedChannel = "stockwatcher_jobs_queued";
export const finishedChannel = "stockwatcher_jobs_finished";

export const leaseMs = 60_000;
export const perUserQueued = 5;

export type JobStatus = "queued" | "running" | "done" | "dead";

export type Job = {
  id: string;
  kind: string;
  userId: string | null;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  result: unknown;
  error: string | null;
};

type JobRow = {
  id: string;
  kind: string;
  user_id: string | null;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  result: unknown;
  error: string | null;
};

const toJob = (row: JobRow): Job => ({
  id: row.id,
  kind: row.kind,
  userId: row.user_id,
  payload: row.payload,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  result: row.result,
  error: row.error,
});

export class QueueFullError extends Error {}

export async function pgSql(): Promise<postgres.Sql> {
  const s = await store();
  if (s.kind !== "pg") throw new Error("The job queue needs DATABASE_URL.");
  return s.sql;
}

export async function enqueue(
  kind: string,
  payload: postgres.JSONValue,
  options: { userId: string | null; maxAttempts?: number },
): Promise<string> {
  const sql = await pgSql();
  const id = randomUUID();
  const inserted = await sql`
    INSERT INTO stockwatcher_jobs
      (id, kind, user_id, payload, status, max_attempts, run_after, created_at)
    SELECT ${id}, ${kind}, ${options.userId}, ${sql.json(payload)}, 'queued',
      ${options.maxAttempts ?? 2}, now(), now()
    WHERE ${options.userId}::text IS NULL OR (
      SELECT COUNT(*) FROM stockwatcher_jobs
      WHERE user_id = ${options.userId} AND status IN ('queued', 'running')
    ) < ${perUserQueued}`;
  if (inserted.count === 0)
    throw new QueueFullError(
      `${perUserQueued} computations are already waiting. Let them finish, then retry.`,
    );
  await sql.notify(queuedChannel, kind);
  return id;
}

export async function readJob(id: string): Promise<Job | null> {
  const sql = await pgSql();
  const [row] = await sql<JobRow[]>`
    SELECT * FROM stockwatcher_jobs WHERE id = ${id}`;
  return row ? toJob(row) : null;
}

/**
 * Leases the oldest ready job whose user has nothing running, so one user's
 * burst cannot hold every worker slot.
 */
export async function claimNext(
  worker: string,
  kinds: readonly string[],
): Promise<Job | null> {
  const sql = await pgSql();
  const [row] = await sql<JobRow[]>`
    UPDATE stockwatcher_jobs SET status = 'running',
      attempts = attempts + 1, worker = ${worker},
      lease_until = now() + ${`${leaseMs} milliseconds`}::interval
    WHERE id = (
      SELECT j.id FROM stockwatcher_jobs j
      WHERE j.status = 'queued' AND j.run_after <= now()
        AND j.kind = ANY(${kinds as string[]})
        AND (j.user_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM stockwatcher_jobs r
          WHERE r.user_id = j.user_id AND r.status = 'running'
        ))
      ORDER BY j.run_after LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return row ? toJob(row) : null;
}

/** False once the lease is lost: the job was reaped and may run elsewhere. */
export async function heartbeat(id: string, worker: string): Promise<boolean> {
  const sql = await pgSql();
  const result = await sql`
    UPDATE stockwatcher_jobs
    SET lease_until = now() + ${`${leaseMs} milliseconds`}::interval
    WHERE id = ${id} AND worker = ${worker} AND status = 'running'`;
  return result.count === 1;
}

export async function complete(
  id: string,
  worker: string,
  result: postgres.JSONValue,
): Promise<void> {
  const sql = await pgSql();
  const updated = await sql`
    UPDATE stockwatcher_jobs SET status = 'done', result = ${sql.json(result)},
      finished_at = now(), lease_until = NULL
    WHERE id = ${id} AND worker = ${worker} AND status = 'running'`;
  if (updated.count) await sql.notify(finishedChannel, id);
}

/** Requeues with backoff while attempts remain, otherwise dead-letters. */
export async function fail(
  id: string,
  worker: string,
  error: string,
): Promise<void> {
  const sql = await pgSql();
  const [row] = await sql<{ status: JobStatus }[]>`
    UPDATE stockwatcher_jobs SET
      status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'dead' END,
      run_after = now() + (attempts * interval '5 seconds'),
      error = ${error.slice(0, 2000)}, lease_until = NULL,
      finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
    WHERE id = ${id} AND worker = ${worker} AND status = 'running'
    RETURNING status`;
  if (row?.status === "dead") await sql.notify(finishedChannel, id);
  else if (row) await sql.notify(queuedChannel, "retry");
}

/** Jobs whose worker stopped heartbeating go back to the queue, or die. */
export async function reapExpired(): Promise<number> {
  const sql = await pgSql();
  const rows = await sql<{ id: string; status: JobStatus }[]>`
    UPDATE stockwatcher_jobs SET
      status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'dead' END,
      error = 'Lease expired', lease_until = NULL, run_after = now(),
      finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
    WHERE status = 'running' AND lease_until < now()
    RETURNING id, status`;
  for (const row of rows)
    if (row.status === "dead") await sql.notify(finishedChannel, row.id);
  if (rows.some((row) => row.status === "queued"))
    await sql.notify(queuedChannel, "reaped");
  return rows.length;
}

export async function purgeFinished(olderThanDays = 7): Promise<number> {
  const sql = await pgSql();
  const result = await sql`
    DELETE FROM stockwatcher_jobs
    WHERE status IN ('done', 'dead')
      AND finished_at < now() - ${`${olderThanDays} days`}::interval`;
  return result.count;
}

/**
 * True for exactly one caller per period across every worker: the winner
 * moves next_run forward in the same statement that checks it.
 */
export async function claimSchedule(
  name: string,
  everyMs: number,
): Promise<boolean> {
  const sql = await pgSql();
  await sql`
    INSERT INTO stockwatcher_schedules (name, next_run) VALUES (${name}, now())
    ON CONFLICT (name) DO NOTHING`;
  const claimed = await sql`
    UPDATE stockwatcher_schedules
    SET next_run = now() + ${`${everyMs} milliseconds`}::interval
    WHERE name = ${name} AND next_run <= now()`;
  return claimed.count === 1;
}
