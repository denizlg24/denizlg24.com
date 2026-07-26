import type {
  ActivityActorType,
  ActivityCategory,
  ActivityFacets,
  ActivityMetadata,
  ActivityQuery,
  ActivitySeverity,
  Pagination,
  SafeActivityEntry,
} from "@repo/schemas/cloud";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../db";
import { activityLog } from "../db/schema";

export interface ActivityEntryInput {
  category: ActivityCategory;
  action: string;
  severity?: ActivitySeverity;
  actorType?: ActivityActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  message?: string | null;
  metadata?: ActivityMetadata | null;
  ts?: Date;
}

const INSERT_BATCH_SIZE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
/**
 * Above this the buffer flushes immediately rather than waiting for the timer.
 */
const DEFAULT_FLUSH_THRESHOLD = 100;
/**
 * A hard ceiling so a database outage cannot turn the buffer into a memory leak
 * on a machine that also has to stream multi-gigabyte files. Oldest entries are
 * dropped first — during an outage the newest events are the interesting ones.
 */
const DEFAULT_MAX_BUFFERED = 5_000;

const PATH_MAX_LENGTH = 2_048;
const USER_AGENT_MAX_LENGTH = 512;
const ACTION_MAX_LENGTH = 128;

function truncate(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Where flushed batches go. Injected rather than reaching for `db` directly so
 * the buffering logic is testable without standing up Postgres.
 */
export type ActivitySink = (
  rows: readonly ActivityEntryInput[],
) => Promise<void>;

export function databaseActivitySink(db: Database): ActivitySink {
  return async (rows) => {
    await db.insert(activityLog).values(rows.map(toRow));
  };
}

export interface ActivityRecorderOptions {
  sink: ActivitySink;
  flushIntervalMs?: number;
  flushThreshold?: number;
  maxBuffered?: number;
}

/**
 * Buffers activity rows and flushes them in batches off the request path.
 *
 * Recording must never fail a request, so `record()` is synchronous and
 * fire-and-forget and every flush error is swallowed after logging. Losing
 * audit rows is strictly better than 500-ing a storage upload because Postgres
 * was briefly busy.
 */
export class ActivityRecorder {
  private readonly sink: ActivitySink;
  private readonly flushIntervalMs: number;
  private readonly flushThreshold: number;
  private readonly maxBuffered: number;
  private buffer: ActivityEntryInput[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private dropped = 0;

  constructor(options: ActivityRecorderOptions) {
    this.sink = options.sink;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushThreshold = options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
    this.maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  record(entry: ActivityEntryInput): void {
    if (this.buffer.length >= this.maxBuffered) {
      this.buffer.shift();
      this.dropped += 1;
      if (this.dropped % 1_000 === 1) {
        console.error(
          `[activity] Buffer full, dropped ${this.dropped} entries so far`,
        );
      }
    }
    this.buffer.push(entry);
    if (this.buffer.length >= this.flushThreshold) {
      void this.flush();
    }
  }

  /** Exposed for tests and for the drain on shutdown. */
  get pending(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, INSERT_BATCH_SIZE);
      try {
        await this.sink(batch);
      } catch (error) {
        // Deliberately not requeued: a poison row would retry forever and the
        // buffer would grow behind it.
        console.error(
          `[activity] Failed to persist ${batch.length} entries`,
          error,
        );
      }
    }
  }
}

function toRow(entry: ActivityEntryInput) {
  return {
    ts: entry.ts ?? new Date(),
    category: entry.category,
    severity: entry.severity ?? "info",
    action: truncate(entry.action, ACTION_MAX_LENGTH) ?? entry.action,
    actorType: entry.actorType ?? "system",
    actorId: entry.actorId ?? null,
    actorLabel: truncate(entry.actorLabel, 255),
    method: entry.method ?? null,
    path: truncate(entry.path, PATH_MAX_LENGTH),
    statusCode: entry.statusCode ?? null,
    durationMs: entry.durationMs ?? null,
    ip: truncate(entry.ip, 64),
    userAgent: truncate(entry.userAgent, USER_AGENT_MAX_LENGTH),
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    message: entry.message ?? null,
    metadata: entry.metadata ?? null,
  };
}

function serializeEntry(
  row: typeof activityLog.$inferSelect,
): SafeActivityEntry {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    category: row.category,
    severity: row.severity,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    method: row.method,
    path: row.path,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    ip: row.ip,
    userAgent: row.userAgent,
    targetType: row.targetType,
    targetId: row.targetId,
    message: row.message,
    metadata: row.metadata,
  };
}

function buildFilters(query: ActivityQuery) {
  const filters = [];
  if (query.category?.length) {
    filters.push(inArray(activityLog.category, query.category));
  }
  if (query.severity?.length) {
    filters.push(inArray(activityLog.severity, query.severity));
  }
  if (query.action) {
    filters.push(eq(activityLog.action, query.action));
  }
  if (query.actorId) {
    filters.push(eq(activityLog.actorId, query.actorId));
  }
  if (query.from) {
    filters.push(gte(activityLog.ts, new Date(query.from)));
  }
  if (query.to) {
    filters.push(lte(activityLog.ts, new Date(query.to)));
  }
  if (query.statusClass === "success") {
    filters.push(sql`${activityLog.statusCode} < 400`);
  } else if (query.statusClass === "client_error") {
    filters.push(
      and(
        gte(activityLog.statusCode, 400),
        sql`${activityLog.statusCode} < 500`,
      ),
    );
  } else if (query.statusClass === "server_error") {
    filters.push(gte(activityLog.statusCode, 500));
  }
  if (query.q) {
    // ILIKE rather than a tsvector: the searchable columns are short, the table
    // is time-pruned, and every realistic query is already narrowed by a range
    // or category filter that an index can serve.
    const pattern = `%${query.q.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    filters.push(
      or(
        sql`${activityLog.path} ILIKE ${pattern}`,
        sql`${activityLog.message} ILIKE ${pattern}`,
        sql`${activityLog.action} ILIKE ${pattern}`,
        sql`${activityLog.actorLabel} ILIKE ${pattern}`,
        sql`${activityLog.targetId} ILIKE ${pattern}`,
      ),
    );
  }
  return filters.length > 0 ? and(...filters) : undefined;
}

export async function queryActivity(
  db: Database,
  query: ActivityQuery,
): Promise<{ entries: SafeActivityEntry[]; pagination: Pagination }> {
  const where = buildFilters(query);
  const offset = (query.page - 1) * query.limit;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(activityLog)
      .where(where)
      .orderBy(desc(activityLog.ts))
      .limit(query.limit)
      .offset(offset),
    db.select({ value: count() }).from(activityLog).where(where),
  ]);

  const total = totalRows[0]?.value ?? 0;
  return {
    entries: rows.map(serializeEntry),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

const FACET_LIMIT = 50;

export async function activityFacets(
  db: Database,
  since: Date,
): Promise<ActivityFacets> {
  const [categories, actions, actors, oldest] = await Promise.all([
    db
      .select({ value: activityLog.category, count: count() })
      .from(activityLog)
      .where(gte(activityLog.ts, since))
      .groupBy(activityLog.category)
      .orderBy(desc(count())),
    db
      .select({ value: activityLog.action, count: count() })
      .from(activityLog)
      .where(gte(activityLog.ts, since))
      .groupBy(activityLog.action)
      .orderBy(desc(count()))
      .limit(FACET_LIMIT),
    db
      .select({
        id: activityLog.actorId,
        label: activityLog.actorLabel,
        count: count(),
      })
      .from(activityLog)
      .where(
        and(
          gte(activityLog.ts, since),
          sql`${activityLog.actorId} IS NOT NULL`,
        ),
      )
      .groupBy(activityLog.actorId, activityLog.actorLabel)
      .orderBy(desc(count()))
      .limit(FACET_LIMIT),
    db
      .select({ ts: activityLog.ts })
      .from(activityLog)
      .orderBy(asc(activityLog.ts))
      .limit(1),
  ]);

  return {
    categories: categories.map((row) => ({
      value: row.value,
      count: row.count,
    })),
    actions: actions.map((row) => ({ value: row.value, count: row.count })),
    actors: actors.flatMap((row) =>
      row.id === null
        ? []
        : [{ id: row.id, label: row.label, count: row.count }],
    ),
    oldestAt: oldest[0]?.ts.toISOString() ?? null,
  };
}

export async function pruneActivity(
  db: Database,
  options: { retentionDays: number; now?: Date },
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - options.retentionDays * 24 * 60 * 60 * 1_000,
  );
  const deleted = await db
    .delete(activityLog)
    .where(lte(activityLog.ts, cutoff))
    .returning({ id: activityLog.id });
  return deleted.length;
}

/**
 * Counts requests in a window, split by outcome. Feeds the api_error_rate
 * notification without a second table.
 */
export async function requestOutcomeCounts(
  db: Database,
  since: Date,
): Promise<{ total: number; serverErrors: number }> {
  const rows = await db
    .select({
      total: count(),
      serverErrors: sql<number>`count(*) FILTER (WHERE ${activityLog.statusCode} >= 500)::int`,
    })
    .from(activityLog)
    .where(
      and(
        gte(activityLog.ts, since),
        sql`${activityLog.statusCode} IS NOT NULL`,
      ),
    );
  return {
    total: rows[0]?.total ?? 0,
    serverErrors: Number(rows[0]?.serverErrors ?? 0),
  };
}

export async function countActivity(
  db: Database,
  options: { action: string; since: Date },
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, options.action),
        gte(activityLog.ts, options.since),
      ),
    );
  return rows[0]?.value ?? 0;
}
