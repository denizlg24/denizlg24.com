import "server-only";
import type postgres from "postgres";
import type { z } from "zod";
import { enqueue, finishedChannel, pgSql, readJob } from "./queue";

/** Data fetching may take up to a minute, then 5 s of sandbox. */
export const computeJobTimeoutMs = 85_000;

/** Web hands work to the worker only when one is deployed beside it. */
export const jobsEnabled = () =>
  process.env.STOCKWATCHER_WORKER === "1" && Boolean(process.env.DATABASE_URL);

const waiters = new Map<string, () => void>();
let listening: Promise<unknown> | undefined;

function listen() {
  listening ??= pgSql()
    .then((sql) =>
      sql.listen(finishedChannel, (id) => {
        waiters.get(id)?.();
      }),
    )
    .catch((error: unknown) => {
      listening = undefined;
      throw error;
    });
  return listening;
}

const pollMs = 2_000;

/**
 * Queues a job and waits for its result. NOTIFY wakes the waiter; a slow poll
 * covers a notification lost to a reconnect.
 */
export async function runJob<T>(
  kind: string,
  payload: postgres.JSONValue,
  options: { userId: string; timeoutMs: number; result: z.ZodType<T> },
): Promise<T> {
  await listen().catch(() => undefined);
  const id = await enqueue(kind, payload, { userId: options.userId });
  const deadline = Date.now() + options.timeoutMs;
  try {
    while (Date.now() < deadline) {
      const job = await readJob(id);
      if (job?.status === "done") return options.result.parse(job.result);
      if (job?.status === "dead")
        throw new Error(job.error ?? "The job failed.");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          resolve,
          Math.min(pollMs, Math.max(0, deadline - Date.now())),
        );
        waiters.set(id, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  } finally {
    waiters.delete(id);
  }
  throw new Error("The computation is taking too long; try a smaller request.");
}
