import type { Database } from "@repo/cloud-core";
import type {
  DatabaseStats,
  MongodbStats,
  PostgresStats,
  RedisStats,
} from "@repo/schemas/cloud";
import { sql } from "drizzle-orm";
import type { MongoClient } from "mongodb";

/** `INFO` returns one blob; only a handful of fields are worth parsing. */
interface RedisInfoClient {
  info(section: string): Promise<string>;
}

export interface DatabaseStatsSources {
  db: Database;
  mongo: MongoClient;
  redis: RedisInfoClient;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Server-wide rather than client-side. postgres-js exposes no pool
 * introspection worth reading, and the number that actually causes an outage is
 * total backends against `max_connections` — every consumer of the Pi's
 * Postgres counts toward it, not just this API.
 *
 * Reserved superuser slots are subtracted so the percentage matches the point
 * at which an ordinary client starts getting refused, not the point at which
 * the server is completely full.
 *
 * Caveat on the state breakdown: Postgres shows every backend's row to any
 * role, but blanks `state` for backends owned by *other* roles unless the
 * reader is superuser or has `pg_read_all_stats`. `connections` and
 * `usagePercent` — the saturation numbers that matter — are always right;
 * active/idle/idle-in-transaction under-count other projects' connections if
 * this API's role is unprivileged. Grant `pg_read_all_stats` to fix.
 */
export async function collectPostgresStats(
  db: Database,
): Promise<PostgresStats> {
  const rows = await db.execute(sql<{
    total: number | string;
    active: number | string;
    idle: number | string;
    idle_in_transaction: number | string;
    waiting: number | string;
    max_connections: number | string;
    reserved: number | string;
  }>`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE state = 'active')::int AS active,
      count(*) FILTER (WHERE state = 'idle')::int AS idle,
      count(*) FILTER (WHERE state LIKE 'idle in transaction%')::int
        AS idle_in_transaction,
      count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting,
      current_setting('max_connections')::int AS max_connections,
      current_setting('superuser_reserved_connections')::int AS reserved
    FROM pg_stat_activity
    WHERE backend_type = 'client backend'
  `);

  const row = Array.from(rows)[0];
  const connections = toNumber(row?.total);
  const maxConnections = toNumber(row?.max_connections);
  const usable = Math.max(1, maxConnections - toNumber(row?.reserved));

  return {
    connections,
    active: toNumber(row?.active),
    idle: toNumber(row?.idle),
    idleInTransaction: toNumber(row?.idle_in_transaction),
    waiting: toNumber(row?.waiting),
    maxConnections,
    usagePercent: (connections / usable) * 100,
  };
}

/**
 * `connections.available` is what is left, not the ceiling, so the ceiling is
 * their sum. This is the pair that would have made the 2026-07-28 outage
 * obvious in one glance.
 */
export async function collectMongodbStats(
  mongo: MongoClient,
): Promise<MongodbStats> {
  const status = await mongo.db("admin").command({ serverStatus: 1 });
  const connections: unknown = Reflect.get(status, "connections");
  const globalLock: unknown = Reflect.get(status, "globalLock");
  const queue =
    typeof globalLock === "object" && globalLock !== null
      ? Reflect.get(globalLock, "currentQueue")
      : null;

  const read = (source: unknown, key: string): number =>
    typeof source === "object" && source !== null
      ? toNumber(Reflect.get(source, key))
      : 0;

  const current = read(connections, "current");
  const available = read(connections, "available");
  const ceiling = current + available;

  return {
    current,
    available,
    active: read(connections, "active"),
    totalCreated: read(connections, "totalCreated"),
    usagePercent: ceiling > 0 ? (current / ceiling) * 100 : 0,
    queuedReaders: read(queue, "readers"),
    queuedWriters: read(queue, "writers"),
    uptimeSeconds: toNumber(Reflect.get(status, "uptime")),
  };
}

function parseRedisInfo(input: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  return values;
}

export async function collectRedisStats(
  redis: RedisInfoClient,
): Promise<RedisStats> {
  const [clientsRaw, memoryRaw] = await Promise.all([
    redis.info("clients"),
    redis.info("memory"),
  ]);
  const clients = parseRedisInfo(clientsRaw);
  const memory = parseRedisInfo(memoryRaw);

  const usedMemoryBytes = toNumber(memory.get("used_memory"));
  // `maxmemory` is 0 when unbounded, in which case a percentage is meaningless
  // rather than zero.
  const maxMemoryBytes = toNumber(memory.get("maxmemory"));

  return {
    connectedClients: toNumber(clients.get("connected_clients")),
    blockedClients: toNumber(clients.get("blocked_clients")),
    usedMemoryBytes,
    maxMemoryBytes,
    usagePercent:
      maxMemoryBytes > 0 ? (usedMemoryBytes / maxMemoryBytes) * 100 : null,
  };
}

/**
 * Every engine is independent and best-effort: one unreachable database must
 * still leave the other two reported, and must never fail the metrics sample
 * that carries host CPU, memory and disk.
 */
export async function collectDatabaseStats(
  sources: DatabaseStatsSources,
): Promise<DatabaseStats> {
  const [postgres, mongodb, redis] = await Promise.all([
    collectPostgresStats(sources.db).catch((error) => {
      console.error("[metrics] Postgres stats failed", error);
      return null;
    }),
    collectMongodbStats(sources.mongo).catch((error) => {
      console.error("[metrics] MongoDB stats failed", error);
      return null;
    }),
    collectRedisStats(sources.redis).catch((error) => {
      console.error("[metrics] Redis stats failed", error);
      return null;
    }),
  ]);
  return { postgres, mongodb, redis };
}
