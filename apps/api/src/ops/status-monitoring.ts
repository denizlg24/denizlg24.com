import { timingSafeEqual } from "node:crypto";
import type { Database } from "@repo/cloud-core";
import { scheduledTasks, taskRuns } from "@repo/cloud-core/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { OpsHealthService } from "./health";
import type { DeepSyntheticService } from "./synthetic";

export const statusProbeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  url: z
    .url()
    .refine((url) => ["http:", "https:"].includes(new URL(url).protocol)),
  upstream: z.string().optional(),
});
export async function probeService(probe: z.infer<typeof statusProbeSchema>) {
  const start = performance.now();
  try {
    const response = await fetch(probe.url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = z
      .object({ status: z.string(), upstream: z.string().optional() })
      .safeParse(body);
    const status = !response.ok
      ? "down"
      : !parsed.success
        ? "unknown"
        : parsed.data.status !== "ok" ||
            (probe.upstream && parsed.data.upstream !== probe.upstream)
          ? "down"
          : "ok";
    return {
      status,
      latencyMs: performance.now() - start,
      message:
        status === "ok"
          ? null
          : `HTTP ${response.status}; service readiness or upstream check did not pass`,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: performance.now() - start,
      message:
        error instanceof Error ? error.message.slice(0, 300) : "Probe failed",
    };
  }
}

const BACKUPS = [
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
] as const;
export function acceptsStatusToken(
  configured: string | undefined,
  supplied: string,
): boolean {
  if (!configured || configured.length < 32) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function bounded<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 12_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function statusMonitoringRoutes(options: {
  token?: string;
  db: Database;
  health: OpsHealthService;
  synthetic: DeepSyntheticService | null;
  extraProbes?: z.infer<typeof statusProbeSchema>[];
}) {
  const app = new Hono();
  app.get("/", async (context) => {
    if (
      !acceptsStatusToken(
        options.token,
        context.req.header("X-Status-Token") ?? "",
      )
    )
      return context.notFound();
    context.header("Cache-Control", "private, no-store");
    const [health, deep, backupData, extra] = await Promise.all([
      bounded(options.health.check()),
      options.synthetic
        ? bounded(options.synthetic.check())
        : Promise.resolve(null),
      bounded(
        (async () => {
          const tasks = await options.db
            .select()
            .from(scheduledTasks)
            .where(inArray(scheduledTasks.type, [...BACKUPS]));
          if (!tasks.length) return { tasks: [], runs: [], successes: [] };
          const ids = tasks.map((task) => task.id);
          const [runs, successes] = await Promise.all([
            options.db
              .select()
              .from(taskRuns)
              .where(inArray(taskRuns.taskId, ids))
              .orderBy(desc(taskRuns.createdAt))
              .limit(100),
            options.db
              .selectDistinctOn([taskRuns.taskId])
              .from(taskRuns)
              .where(
                and(
                  inArray(taskRuns.taskId, ids),
                  eq(taskRuns.status, "completed"),
                ),
              )
              .orderBy(taskRuns.taskId, desc(taskRuns.completedAt)),
          ]);
          return { tasks, runs, successes };
        })(),
      ),
      Promise.all(
        (options.extraProbes ?? []).map(
          async (probe) => [probe.id, await probeService(probe)] as const,
        ),
      ),
    ]);
    // This endpoint transports observations; its 200 is never a health verdict.
    // The collector interprets every nested check, including null/timeouts.
    return context.json({
      timestamp: new Date().toISOString(),
      health,
      deep,
      extra: {
        timestamp: new Date().toISOString(),
        checks: Object.fromEntries(extra),
      },
      backups: backupData,
    });
  });
  return app;
}
