import type { Database } from "@repo/cloud-core";
import type { HealthCheck, OpsHealth } from "@repo/schemas/cloud";
import { sql } from "drizzle-orm";
import type { MongoClient } from "mongodb";

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

export class OpsHealthService {
  private readonly fetchImplementation: typeof fetch;
  private readonly diskHeadroomPercent: number;

  constructor(private readonly options: OpsHealthServiceOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.diskHeadroomPercent = options.diskHeadroomPercent ?? 10;
  }

  async check(): Promise<OpsHealth> {
    const tunnelUrl = this.options.tunnelUrl;
    const [postgres, mongodb, redis, meilisearch, mongot, disk, tunnel] =
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
      ]);

    const checks = {
      postgres,
      mongodb,
      mongot,
      redis,
      meilisearch,
      disk,
      tunnel,
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
