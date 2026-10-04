import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SYNTHETIC_DEPENDENCIES = [
  "postgres",
  "mongodb",
  "redis",
  "posix",
  "objectStorage",
  "search",
  "storageProtocol",
] as const;

type SyntheticDependency = (typeof SYNTHETIC_DEPENDENCIES)[number];

/**
 * A probe that completed, but only far enough to prove the dependency is
 * serving — not far enough to assert the whole transaction. Reported as
 * `degraded`, which the status page shows without ever confirming an outage,
 * and which keeps `/healthz/deep` answering 200 so the uptime monitor stays
 * green. Reserve it for "alive but behind"; anything that proves the
 * dependency is broken must still throw.
 */
export type SyntheticDegradation = { status: "degraded"; message: string };
type SyntheticProbe = (canary: string) => Promise<SyntheticDegradation | void>;

export type SyntheticResult = {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  checks: Record<
    SyntheticDependency,
    {
      status: "ok" | "degraded" | "down";
      latencyMs: number;
      error: string | null;
      message?: string;
    }
  >;
};

/** A write/read/delete probe for a mounted POSIX or object-storage root. */
export function filesystemSyntheticProbe(root: string): SyntheticProbe {
  return async (canary) => {
    const directory = join(root, ".dr-synthetic");
    const path = join(directory, canary);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, canary, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      if ((await readFile(path, "utf8")) !== canary) {
        throw new Error("canary read did not match its write");
      }
    } finally {
      await rm(path, { force: true });
    }
  };
}

/**
 * Runs the complete dependency transaction as one serialized check. A second
 * monitor hit shares the in-flight result instead of racing the same canaries.
 */
export class DeepSyntheticService {
  private inFlight: Promise<SyntheticResult> | null = null;

  constructor(
    private readonly probes: Record<SyntheticDependency, SyntheticProbe>,
  ) {}

  check(): Promise<SyntheticResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<SyntheticResult> {
    const canary = randomUUID();
    const entries = await Promise.all(
      SYNTHETIC_DEPENDENCIES.map(async (name) => {
        const startedAt = performance.now();
        try {
          const outcome = await this.probes[name](canary);
          return [
            name,
            {
              status: outcome?.status ?? ("ok" as const),
              latencyMs: performance.now() - startedAt,
              error: null,
              ...(outcome ? { message: outcome.message } : {}),
            },
          ] as const;
        } catch (error) {
          return [
            name,
            {
              status: "down" as const,
              latencyMs: performance.now() - startedAt,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "Probe failed",
            },
          ] as const;
        }
      }),
    );
    const checks = Object.fromEntries(entries) as SyntheticResult["checks"];
    const statuses = Object.values(checks).map((check) => check.status);
    return {
      // `down` only when a probe proved something broken. A degraded probe
      // must not reach this, or the endpoint answers 503 and the uptime
      // monitor opens an incident for a dependency that is still serving.
      status: statuses.includes("down")
        ? "down"
        : statuses.includes("degraded")
          ? "degraded"
          : "ok",
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}

const SEARCH_INDEX_UID = "deniz_dr_synthetic";
/**
 * How long the canary may sit in Meilisearch's task queue before the probe
 * stops waiting. Meilisearch processes tasks serially, so this is a queue-depth
 * budget, not a liveness one: a healthy idle engine resolves the canary in well
 * under a second, and anything longer means other work is ahead of it.
 */
export const SEARCH_TASK_BUDGET_MS = 5_000;
const SEARCH_TASK_POLL_MS = 50;

/** The slice of the Meilisearch client the search probe uses. */
export type SearchProbeClient = {
  index(uid: string): {
    addDocuments(
      documents: { id: string; value: string }[],
      options?: { primaryKey?: string },
    ): Promise<{ taskUid: number }>;
    getDocument(id: string): Promise<{ value?: string } | undefined>;
    deleteDocument(id: string): Promise<unknown>;
    search(query: string, options?: { limit?: number }): Promise<unknown>;
  };
  tasks: {
    getTask(uid: number): Promise<
      | {
          status: string;
          error?: { message?: string } | null;
        }
      | undefined
    >;
  };
};

/**
 * A write/read/delete probe for the search engine.
 *
 * Deliberately does not use the client's own `waitTask()`. That polls with a
 * 5 s default and throws on expiry, which made a merely busy task queue
 * indistinguishable from a dead engine: on 2026-10-04 a queue backlog held the
 * canary past the budget for ten minutes straight and took `search` and
 * `deep-health` to a confirmed outage while Meilisearch was answering queries
 * in single-digit milliseconds the whole time. It also crashed outright
 * (`undefined is not an object (evaluating '…status')`) whenever a poll came
 * back without a task body, because the client reads `.status` off the parsed
 * response unguarded.
 *
 * So the queue is given a bounded budget, and overrunning it is a degradation
 * rather than an outage — but only once the read path has been shown to work,
 * which is what every consumer of search actually depends on. A task that
 * resolves to anything but `succeeded` is still a hard failure: that is the
 * engine accepting writes and losing them, the condition this probe exists for.
 */
export function searchSyntheticProbe(
  client: SearchProbeClient,
  taskBudgetMs = SEARCH_TASK_BUDGET_MS,
): SyntheticProbe {
  return async (canary) => {
    const index = client.index(SEARCH_INDEX_UID);
    const enqueued = await index.addDocuments([{ id: canary, value: canary }], {
      primaryKey: "id",
    });
    try {
      const task = await waitForSearchTask(
        client,
        enqueued.taskUid,
        taskBudgetMs,
      );
      if (!task) {
        // Still queued. The engine took the write and is reachable; prove it is
        // also serving reads before letting this pass as a degradation, so a
        // genuinely wedged engine is not waved through.
        await index.search(canary, { limit: 1 });
        return {
          status: "degraded",
          message: `canary task ${enqueued.taskUid} still queued after ${taskBudgetMs}ms; search is serving reads`,
        };
      }
      if (task.status !== "succeeded")
        throw new Error(
          `canary task ${enqueued.taskUid} ${task.status}: ${
            task.error?.message ?? "no failure detail"
          }`,
        );
      const found = await index.getDocument(canary);
      if (found?.value !== canary)
        throw new Error("canary read did not match its write");
    } finally {
      // Enqueued, not awaited: waiting here doubled the probe's latency for no
      // assertion, and the delete is processed whenever the queue drains.
      await index.deleteDocument(canary).catch(() => undefined);
    }
  };
}

/** The resolved task, or null once the budget is spent with it still pending. */
async function waitForSearchTask(
  client: SearchProbeClient,
  taskUid: number,
  budgetMs: number,
): Promise<{ status: string; error?: { message?: string } | null } | null> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const task = await client.tasks.getTask(taskUid);
    // A poll that came back without a task body says nothing about the task.
    // Treat it as pending rather than dereferencing it.
    if (task && task.status !== "enqueued" && task.status !== "processing")
      return task;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SEARCH_TASK_POLL_MS));
  }
}
