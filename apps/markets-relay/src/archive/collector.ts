import type { SQL } from "bun";
import { archiveLog, errorMessage, jitter } from "./util";

export interface Collector {
  name: string;
  intervalMs(now: Date): number;
  /** Returns the number of rows written. */
  run(): Promise<number>;
}

export interface CollectorStatus {
  name: string;
  running: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  lastRows: number | null;
}

const MAX_BACKOFF_MS = 6 * 3_600_000;
const FIRST_RUN_SPREAD_MS = 55_000;
const FIRST_RUN_MIN_MS = 5_000;

export function nextDelayMs(intervalMs: number, failures: number): number {
  const base =
    failures === 0
      ? intervalMs
      : Math.min(
          intervalMs * 2 ** failures,
          Math.max(intervalMs, MAX_BACKOFF_MS),
        );
  return jitter(base, 0.1);
}

interface Entry {
  collector: Collector;
  status: CollectorStatus;
  timer: ReturnType<typeof setTimeout> | null;
}

export class Scheduler {
  private readonly entries: Entry[];
  private stopped = false;

  constructor(
    private readonly sql: SQL,
    collectors: Collector[],
  ) {
    this.entries = collectors.map((collector) => ({
      collector,
      timer: null,
      status: {
        name: collector.name,
        running: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        lastRows: null,
      },
    }));
  }

  statuses(): CollectorStatus[] {
    return this.entries.map((entry) => ({ ...entry.status }));
  }

  async start(): Promise<void> {
    for (const entry of this.entries) {
      const lastSuccess = await this.restore(entry);
      const interval = entry.collector.intervalMs(new Date());
      const dueIn =
        lastSuccess === null
          ? 0
          : Math.max(0, lastSuccess + interval - Date.now());
      const first = FIRST_RUN_MIN_MS + Math.random() * FIRST_RUN_SPREAD_MS;
      this.schedule(entry, Math.max(first, dueIn));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.entries) {
      if (entry.timer) clearTimeout(entry.timer);
    }
  }

  private async restore(entry: Entry): Promise<number | null> {
    try {
      const rows: {
        last_run_at: Date | null;
        last_success_at: Date | null;
        last_error: string | null;
        last_error_at: Date | null;
        consecutive_failures: number;
      }[] = await this.sql`
        SELECT last_run_at, last_success_at, last_error, last_error_at, consecutive_failures
        FROM archive_collector_state WHERE collector = ${entry.collector.name}`;
      const row = rows[0];
      if (!row) return null;
      entry.status.lastRunAt = row.last_run_at?.toISOString() ?? null;
      entry.status.lastSuccessAt = row.last_success_at?.toISOString() ?? null;
      entry.status.lastError = row.last_error;
      entry.status.lastErrorAt = row.last_error_at?.toISOString() ?? null;
      entry.status.consecutiveFailures = row.consecutive_failures;
      return row.last_success_at?.getTime() ?? null;
    } catch (error) {
      archiveLog(
        `${entry.collector.name}: could not restore state: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private schedule(entry: Entry, delayMs: number): void {
    if (this.stopped) return;
    entry.timer = setTimeout(() => {
      void this.execute(entry);
    }, delayMs);
  }

  private async execute(entry: Entry): Promise<void> {
    const { collector, status } = entry;
    if (status.running) return;
    status.running = true;
    const startedAt = new Date();
    status.lastRunAt = startedAt.toISOString();
    let error: string | null = null;
    try {
      const rows = await collector.run();
      status.lastRows = rows;
      status.lastSuccessAt = new Date().toISOString();
      status.lastError = null;
      status.consecutiveFailures = 0;
      archiveLog(`${collector.name}: ok, ${rows} rows`);
    } catch (caught) {
      error = errorMessage(caught).slice(0, 500);
      status.lastError = error;
      status.lastErrorAt = new Date().toISOString();
      status.consecutiveFailures += 1;
      archiveLog(
        `${collector.name}: failed (${status.consecutiveFailures} in a row): ${error}`,
      );
    } finally {
      status.running = false;
    }
    await this.persist(entry, startedAt, error);
    this.schedule(
      entry,
      nextDelayMs(collector.intervalMs(new Date()), status.consecutiveFailures),
    );
  }

  private async persist(
    entry: Entry,
    startedAt: Date,
    error: string | null,
  ): Promise<void> {
    const { status, collector } = entry;
    try {
      await this.sql`
        INSERT INTO archive_collector_state
          (collector, last_run_at, last_success_at, last_error, last_error_at, consecutive_failures)
        VALUES (
          ${collector.name}, ${startedAt},
          ${status.lastSuccessAt ? new Date(status.lastSuccessAt) : null},
          ${error}, ${error ? new Date() : null}, ${status.consecutiveFailures}
        )
        ON CONFLICT (collector) DO UPDATE SET
          last_run_at = EXCLUDED.last_run_at,
          last_success_at = COALESCE(EXCLUDED.last_success_at, archive_collector_state.last_success_at),
          last_error = EXCLUDED.last_error,
          last_error_at = COALESCE(EXCLUDED.last_error_at, archive_collector_state.last_error_at),
          consecutive_failures = EXCLUDED.consecutive_failures`;
    } catch (caught) {
      archiveLog(
        `${collector.name}: could not persist state: ${errorMessage(caught)}`,
      );
    }
  }
}
