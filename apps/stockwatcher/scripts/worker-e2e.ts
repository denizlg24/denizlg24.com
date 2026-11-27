/**
 * Spawns the bundled worker against DATABASE_URL, queues jobs straight into
 * stockwatcher_jobs and checks they come back: a compute that needs no market
 * data, a script that throws, the per-user running limit, and /healthz.
 *
 *   bun run worker:build && bun --env-file=.env.local scripts/worker-e2e.ts
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");
const port = 3391;
const sql = postgres(url, { max: 2, onnotice: () => {} });
const user = `e2e:${randomUUID()}`;

const worker = Bun.spawn(["node", "dist/worker.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    WORKER_CONCURRENCY: "4",
    ALERT_MONITOR: "0",
    BROKER_SYNC: "0",
  },
  stdout: "inherit",
  stderr: "inherit",
});

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  ms: number,
): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    await Bun.sleep(250);
  }
  return undefined;
}

async function queue(code: string) {
  const id = randomUUID();
  await sql`
    INSERT INTO stockwatcher_jobs
      (id, kind, user_id, payload, status, max_attempts, run_after, created_at)
    VALUES (${id}, 'compute', ${user},
      ${sql.json({ request: {}, code })}, 'queued', 2, now(), now())`;
  await sql.notify("stockwatcher_jobs_queued", "compute");
  return id;
}

type Row = {
  status: string;
  result: { ok: boolean; json?: string; error?: string } | null;
  started: Date | null;
  finished: Date | null;
};

const settled = (id: string) =>
  waitFor(async () => {
    const [row] = await sql<Row[]>`
      SELECT status, result, created_at AS started, finished_at AS finished
      FROM stockwatcher_jobs WHERE id = ${id}`;
    return row && (row.status === "done" || row.status === "dead")
      ? row
      : undefined;
  }, 30_000);

try {
  const healthy = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    return response.ok ? true : undefined;
  }, 20_000);
  check(healthy === true, "/healthz answers 200");

  const sum = await settled(await queue("return ta.sum([1, 2, 3.5]);"));
  check(
    sum?.status === "done" &&
      sum.result?.ok === true &&
      sum.result.json === "6.5",
    "compute job returns the script's value",
  );

  const thrown = await settled(await queue('throw new Error("boom");'));
  check(
    thrown?.status === "done" &&
      thrown.result?.ok === false &&
      Boolean(thrown.result.error?.includes("boom")),
    "a failing script is a result, not a retry",
  );

  const slow = "let x = 0; for (let i = 0; i < 4e7; i++) x += i; return x > 0;";
  const ids = await Promise.all([queue(slow), queue(slow), queue(slow)]);
  const overlaps = await waitFor(async () => {
    const [row] = await sql<{ running: number }[]>`
      SELECT COUNT(*)::int AS running FROM stockwatcher_jobs
      WHERE user_id = ${user} AND status = 'running'`;
    return row && row.running > 1 ? row.running : undefined;
  }, 4_000);
  check(overlaps === undefined, "one user never has two jobs running");
  const done = await Promise.all(ids.map(settled));
  check(
    done.every((row) => row?.status === "done"),
    "a user's queued jobs all finish",
  );
} finally {
  worker.kill("SIGTERM");
  await worker.exited;
  await sql`DELETE FROM stockwatcher_jobs WHERE user_id = ${user}`;
  await sql.end();
}

if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
