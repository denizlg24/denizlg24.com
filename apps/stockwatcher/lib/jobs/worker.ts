import "server-only";
import { createServer } from "node:http";
import { hostname } from "node:os";
import type postgres from "postgres";
import { z } from "zod";
import { executeCompute } from "../ai/compute-tools";
import { monitorAlerts } from "../alert-monitor";
import { syncDueLinks } from "../brokers/sync";
import { purgeExpiredRuns } from "../run-retention";
import {
  claimNext,
  claimSchedule,
  complete,
  fail,
  heartbeat,
  type Job,
  leaseMs,
  pgSql,
  purgeFinished,
  queuedChannel,
  reapExpired,
} from "./queue";

const computePayload = z.object({ request: z.unknown(), code: z.string() });

const handlers: Record<string, (job: Job) => Promise<postgres.JSONValue>> = {
  compute: async (job) => {
    const { request, code } = computePayload.parse(job.payload);
    return executeCompute(request, code);
  },
};

type Schedule = {
  name: string;
  everyMs: number;
  enabled: () => boolean;
  run: () => Promise<unknown>;
};

const schedules: Schedule[] = [
  {
    name: "alert-monitor",
    everyMs: 120_000,
    enabled: () => process.env.ALERT_MONITOR === "1",
    run: monitorAlerts,
  },
  {
    name: "broker-sync",
    everyMs: 30 * 60_000,
    enabled: () => process.env.BROKER_SYNC !== "0",
    run: syncDueLinks,
  },
  {
    name: "run-retention",
    everyMs: 6 * 60 * 60_000,
    enabled: () => true,
    run: purgeExpiredRuns,
  },
  {
    name: "job-retention",
    everyMs: 6 * 60 * 60_000,
    enabled: () => true,
    run: () => purgeFinished(),
  },
];

const errorName = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 300) : "Unknown error";

export async function startWorker(options: {
  concurrency: number;
  port: number;
}) {
  const id = `${hostname()}:${process.pid}`;
  const kinds = Object.keys(handlers);
  const sql = await pgSql();
  const running = new Set<Promise<void>>();
  const activeSchedules = new Set<string>();
  let stopping = false;
  let lastTick = Date.now();
  let wake: (() => void) | undefined;

  async function runJob(job: Job) {
    const handler = handlers[job.kind];
    const beat = setInterval(() => {
      void heartbeat(job.id, id).then((held) => {
        if (!held)
          console.warn("Stockwatcher worker lost a lease", { job: job.id });
      });
    }, leaseMs / 4);
    try {
      if (!handler) throw new Error(`No handler for ${job.kind}`);
      await complete(job.id, id, await handler(job));
    } catch (error) {
      console.error("Stockwatcher job failed", {
        job: job.id,
        kind: job.kind,
        error: errorName(error),
      });
      await fail(job.id, id, errorName(error)).catch(() => undefined);
    } finally {
      clearInterval(beat);
    }
  }

  async function fill() {
    while (!stopping && running.size < options.concurrency) {
      const job = await claimNext(id, kinds);
      if (!job) return;
      const task = runJob(job).finally(() => {
        running.delete(task);
        wake?.();
      });
      running.add(task);
    }
  }

  function runSchedules() {
    for (const schedule of schedules) {
      if (activeSchedules.has(schedule.name) || !schedule.enabled()) continue;
      void claimSchedule(schedule.name, schedule.everyMs)
        .then(async (claimed) => {
          if (!claimed) return;
          activeSchedules.add(schedule.name);
          try {
            await schedule.run();
          } finally {
            activeSchedules.delete(schedule.name);
          }
        })
        .catch((error: unknown) =>
          console.error("Stockwatcher schedule failed", {
            schedule: schedule.name,
            error: errorName(error),
          }),
        );
    }
  }

  await sql.listen(queuedChannel, () => wake?.());

  const health = createServer((request, response) => {
    const healthy = !stopping && Date.now() - lastTick < 30_000;
    response.writeHead(request.url === "/healthz" && healthy ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ ok: healthy, running: running.size }));
  });
  health.listen(options.port);

  let lastReap = 0;
  let lastSchedules = 0;
  const loop = async () => {
    while (!stopping) {
      lastTick = Date.now();
      try {
        if (lastTick - lastReap > 30_000) {
          lastReap = lastTick;
          await reapExpired();
        }
        if (lastTick - lastSchedules > 15_000) {
          lastSchedules = lastTick;
          runSchedules();
        }
        await fill();
      } catch (error) {
        console.error("Stockwatcher worker loop failed", {
          error: errorName(error),
        });
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  };

  const stopped = loop();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    wake?.();
    await stopped;
    await Promise.race([
      Promise.allSettled(running),
      new Promise((resolve) => setTimeout(resolve, 20_000)),
    ]);
    health.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  console.info("Stockwatcher worker started", {
    id,
    concurrency: options.concurrency,
    kinds,
  });
}
