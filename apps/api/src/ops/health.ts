import type { Database } from "@repo/cloud-core";
import type { HealthCheck, OpsHealth } from "@repo/schemas/cloud";
import { sql } from "drizzle-orm";
import type { MongoClient } from "mongodb";
import { z } from "zod";

import type { MetricsSampler } from "./sampler";

interface RedisHealthClient {
  ping(): Promise<string>;
}

export interface OpsHealthServiceOptions {
  db: Database;
  mongo: MongoClient;
  redis: RedisHealthClient;
  sampler: MetricsSampler;
  meilisearchUrl: string;
  mongotUrl: string;
  tunnelUrl?: string;
  /** Null when no deploy agent is configured; the check then reports unknown. */
  forgeUrl?: string | null;
  forgeToken?: string | null;
  diskHeadroomPercent?: number;
  fetchImplementation?: typeof fetch;
}

async function timedCheck(check: () => Promise<void>): Promise<HealthCheck> {
  const startedAt = performance.now();
  try {
    await check();
    return {
      status: "ok",
      latencyMs: performance.now() - startedAt,
      message: null,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: performance.now() - startedAt,
      message: error instanceof Error ? error.message.slice(0, 500) : "Failed",
    };
  }
}

async function httpCheck(
  fetchImplementation: typeof fetch,
  url: string,
): Promise<void> {
  const response = await fetchImplementation(url, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

/**
 * Deliberately not `agentHealthSchema.partial()`. That validates the whole
 * body, so an agent that added a field to `docker` would fail the parse and
 * take `status` down with it — reporting a box whose Docker is unreachable as
 * healthy. Each field is read on its own and a field that does not parse is
 * simply absent.
 */
const forgeHealthBodySchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]).nullish().catch(undefined),
  docker: z.object({ error: z.string().nullish() }).nullish().catch(undefined),
  disk: z
    .object({ usedPercent: z.number().nullish() })
    .nullish()
    .catch(undefined),
  queue: z
    .object({ running: z.number(), capacity: z.number() })
    .nullish()
    .catch(undefined),
});

/** What the agent said about itself, collapsed into a check. */
export function interpretForgeHealth(
  status: number,
  body: unknown,
  latencyMs: number,
): HealthCheck {
  const parsed = forgeHealthBodySchema.safeParse(body);
  const data = parsed.success ? parsed.data : null;
  if (status >= 400 || data?.status === "unavailable") {
    return {
      status: "down",
      latencyMs,
      message: data?.docker?.error ?? `HTTP ${status}`,
    };
  }
  const queue = data?.queue;
  const depth = queue ? `${queue.running}/${queue.capacity} building` : null;
  if (data?.status === "degraded") {
    const usedPercent = data.disk?.usedPercent;
    const parts = [
      usedPercent === null || usedPercent === undefined
        ? null
        : `disk at ${usedPercent.toFixed(1)}%`,
      depth,
    ].filter(Boolean);
    return {
      status: "degraded",
      latencyMs,
      message: parts.length > 0 ? parts.join(", ") : "The agent is degraded",
    };
  }
  return { status: "ok", latencyMs, message: depth };
}

export class OpsHealthService {
  private readonly fetchImplementation: typeof fetch;
  private readonly diskHeadroomPercent: number;

  constructor(private readonly options: OpsHealthServiceOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.diskHeadroomPercent = options.diskHeadroomPercent ?? 10;
  }

  async check(): Promise<OpsHealth> {
    const tunnelUrl = this.options.tunnelUrl;
    const [postgres, mongodb, redis, meilisearch, mongot, disk, tunnel, forge] =
      await Promise.all([
        timedCheck(async () => {
          await this.options.db.execute(sql`select 1`);
        }),
        timedCheck(async () => {
          await this.options.mongo.db("admin").command({ ping: 1 });
        }),
        timedCheck(async () => {
          const response = await this.options.redis.ping();
          if (response !== "PONG") throw new Error("Redis did not return PONG");
        }),
        timedCheck(() =>
          httpCheck(
            this.fetchImplementation,
            new URL("/health", this.options.meilisearchUrl).toString(),
          ),
        ),
        timedCheck(() =>
          httpCheck(
            this.fetchImplementation,
            `${this.options.mongotUrl.replace(/\/$/, "")}/ready`,
          ),
        ),
        this.diskCheck(),
        tunnelUrl
          ? timedCheck(() => httpCheck(this.fetchImplementation, tunnelUrl))
          : Promise.resolve({
              status: "unknown",
              latencyMs: null,
              message: "TUNNEL_HEALTH_URL is not configured",
            } satisfies HealthCheck),
        this.forgeCheck(),
      ]);

    const checks = {
      postgres,
      mongodb,
      mongot,
      redis,
      meilisearch,
      disk,
      tunnel,
      forge,
    };
    const values = Object.values(checks);
    const status = values.some((check) => check.status === "down")
      ? "down"
      : values.some((check) => check.status !== "ok")
        ? "degraded"
        : "ok";

    return {
      status,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * The deploy host, reached over the same token the proxy uses. Its `/healthz`
   * answers 503 when Docker is unreachable, which is the case a plain liveness
   * probe reports as healthy while every build fails — so the body's own status
   * is what `interpretForgeHealth` reads, not just the transport succeeding.
   */
  private async forgeCheck(): Promise<HealthCheck> {
    const url = this.options.forgeUrl;
    if (!url) {
      return {
        status: "unknown",
        latencyMs: null,
        message: "DEPLOY_AGENT_URL is not configured",
      };
    }
    const startedAt = performance.now();
    try {
      const response = await this.fetchImplementation(url, {
        headers: this.options.forgeToken
          ? { authorization: `Bearer ${this.options.forgeToken}` }
          : {},
        signal: AbortSignal.timeout(5_000),
      });
      return interpretForgeHealth(
        response.status,
        await response.json().catch(() => null),
        performance.now() - startedAt,
      );
    } catch (error) {
      return {
        status: "down",
        latencyMs: performance.now() - startedAt,
        message:
          error instanceof Error ? error.message.slice(0, 500) : "Failed",
      };
    }
  }

  private async diskCheck(): Promise<HealthCheck> {
    const startedAt = performance.now();
    try {
      const overview = await this.options.sampler.overview();
      const offline = overview.disks.filter((disk) => !disk.online);
      const constrained = overview.disks.filter(
        (disk) =>
          disk.online && 100 - disk.usagePercent < this.diskHeadroomPercent,
      );
      if (offline.length > 0) {
        return {
          status: "down",
          latencyMs: performance.now() - startedAt,
          message: `Offline: ${offline.map((disk) => disk.device).join(", ")}`,
        };
      }
      if (constrained.length > 0) {
        return {
          status: "degraded",
          latencyMs: performance.now() - startedAt,
          message: `Low headroom: ${constrained.map((disk) => disk.device).join(", ")}`,
        };
      }
      return {
        status: "ok",
        latencyMs: performance.now() - startedAt,
        message: null,
      };
    } catch (error) {
      return {
        status: "down",
        latencyMs: performance.now() - startedAt,
        message:
          error instanceof Error ? error.message.slice(0, 500) : "Failed",
      };
    }
  }
}
