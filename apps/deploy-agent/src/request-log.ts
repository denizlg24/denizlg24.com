import { open } from "node:fs/promises";
import { join } from "node:path";

import type {
  ForgeRequestLogRecord,
  ForgeRequestStats,
} from "@repo/schemas/cloud";

/**
 * Read through a fixed buffer on a descriptor, never `Bun.file().stream()`. The
 * repository has measured this: streaming a 629 MB file grew RSS by 680 MB that
 * `Bun.gc(true)` would not give back, while a descriptor read into one reused
 * buffer grew it by 3 MB. Access logs roll at 16 MB so no single read is that
 * large, but the tail path below reads a whole file and this is the pattern that
 * is safe when one has just rolled.
 */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Ceiling on durations held for one interval's percentiles. A Pi serving a
 * handful of apps will never approach it; a scraper hammering one deployment
 * would, and an unbounded array is the difference between a slow window and an
 * OOM-killed agent. Past the cap the interval reports percentiles over its first
 * N requests, which is a bounded inaccuracy rather than a failure.
 */
const MAX_DURATION_SAMPLES = 20_000;

/** Never buffer more than this looking for a newline. */
const MAX_LINE_BYTES = 1024 * 1024;

interface CaddyAccessLine {
  ts?: unknown;
  status?: unknown;
  duration?: unknown;
  size?: unknown;
  request?: {
    method?: unknown;
    host?: unknown;
    uri?: unknown;
    proto?: unknown;
    client_ip?: unknown;
    remote_ip?: unknown;
    headers?: Record<string, unknown>;
  };
}

function firstHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | null {
  const value = headers?.[name];
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}

/**
 * One log line to one record, or null.
 *
 * Null rather than throwing for anything unrecognised: the file is written by
 * another process and read while it is being appended to, so a half-written final
 * line is expected rather than exceptional. Caddy's own startup and error lines
 * land in the same file only if a logger is misconfigured, and those should be
 * skipped too rather than take a whole poll down.
 */
export function parseAccessLogLine(line: string): ForgeRequestLogRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) return null;

  let parsed: CaddyAccessLine;
  try {
    parsed = JSON.parse(trimmed) as CaddyAccessLine;
  } catch {
    return null;
  }

  const { ts, status, duration, size, request } = parsed;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  if (!request || typeof request !== "object") return null;

  const method = request.method;
  const host = request.host;
  const uri = request.uri;
  if (typeof method !== "string" || typeof host !== "string") return null;
  if (typeof uri !== "string") return null;

  const clientIp =
    typeof request.client_ip === "string"
      ? request.client_ip
      : typeof request.remote_ip === "string"
        ? request.remote_ip
        : "";

  return {
    // Caddy writes float seconds; the wire format is an ISO timestamp.
    ts: new Date(ts * 1_000).toISOString(),
    status,
    method,
    host,
    uri,
    proto: typeof request.proto === "string" ? request.proto : "",
    durationMs:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration * 1_000
        : 0,
    bytesOut:
      typeof size === "number" && Number.isFinite(size) && size > 0
        ? Math.trunc(size)
        : 0,
    clientIp,
    userAgent: firstHeader(request.headers, "User-Agent"),
    referer: firstHeader(request.headers, "Referer"),
  };
}

/**
 * Nearest-rank percentile over an already-sorted array. Deliberately not
 * interpolating: a p95 that lands between two observed latencies reports a
 * duration no request actually had, which is worse than useless when the whole
 * point is to recognise the slow one.
 */
export function percentile(
  sorted: readonly number[],
  fraction: number,
): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? 0;
}

export function summariseRequests(
  deploymentId: string,
  records: readonly ForgeRequestLogRecord[],
): ForgeRequestStats {
  const durations: number[] = [];
  const stats: ForgeRequestStats = {
    deploymentId,
    count: records.length,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    bytesOut: 0,
    durationP50Ms: 0,
    durationP95Ms: 0,
  };

  for (const record of records) {
    stats.bytesOut += record.bytesOut;
    if (durations.length < MAX_DURATION_SAMPLES) {
      durations.push(record.durationMs);
    }
    // 1xx is counted in `count` and in no class. It is not an outcome, and
    // folding it into 2xx would report a success that has not happened yet.
    if (record.status >= 500) stats.status5xx += 1;
    else if (record.status >= 400) stats.status4xx += 1;
    else if (record.status >= 300) stats.status3xx += 1;
    else if (record.status >= 200) stats.status2xx += 1;
  }

  durations.sort((left, right) => left - right);
  stats.durationP50Ms = percentile(durations, 0.5);
  stats.durationP95Ms = percentile(durations, 0.95);
  return stats;
}

export interface RequestLogStoreOptions {
  root: string;
  /** Injected in tests; production reads the real clock through `Date.now`. */
  now?: () => number;
}

interface Cursor {
  offset: number;
  /** Carried across reads so a record split by a chunk boundary survives. */
  partial: string;
  /**
   * Identifies the file itself, not its name. Caddy rolls by renaming and opening
   * a fresh file, so the path outlives the inode — and a size comparison alone
   * misses the roll whenever the new file has already grown past the old offset
   * by the next poll, which then reads from the middle of a record.
   */
  dev: number;
  ino: number;
}

/**
 * Reads the per-deployment JSON access logs Caddy writes.
 *
 * Two jobs, deliberately in one place because they share the file-format
 * knowledge: draining new lines for the interval counters the control plane
 * persists, and replaying the tail for the live request list.
 *
 * There is no persistence here at all. Aggregates go to `metrics_samples` through
 * the telemetry snapshot, and the raw list is read through on demand — the same
 * arrangement container logs already have, for the same reason: a request-per-row
 * table on this box would outgrow everything else on it.
 */
export class RequestLogStore {
  readonly #root: string;
  readonly #cursors = new Map<string, Cursor>();

  constructor(options: RequestLogStoreOptions) {
    this.#root = options.root;
  }

  /**
   * Guarded here as well as at the route, because this is where a name becomes a
   * path: a caller passing `../../var/log/syslog` would otherwise read outside the
   * access root. The route rejecting non-uuids is the first line, this is the one
   * that holds if another caller is added later.
   */
  pathFor(deploymentId: string): string {
    if (deploymentId.includes("/") || deploymentId.includes("\\")) {
      throw new Error(`Unsafe deployment id: ${deploymentId}`);
    }
    const path = join(this.#root, `${deploymentId}.log`);
    if (!path.startsWith(`${this.#root}/`)) {
      throw new Error(`Unsafe deployment id: ${deploymentId}`);
    }
    return path;
  }

  /** Stops tracking a deployment whose container has gone. */
  forget(deploymentId: string): void {
    this.#cursors.delete(deploymentId);
  }

  /**
   * Everything appended since the last call, and nothing twice.
   *
   * The first call for a deployment seeks to the end rather than reading the
   * whole file: the counters describe an interval, and a cold start that counted
   * every request since the file was created would report one enormous spike.
   *
   * A file smaller than the stored offset has rolled, so the cursor resets to the
   * start of the new one. Caddy renames on roll and opens a fresh file, so the
   * lines written to the old one between the last poll and the roll are lost —
   * which is the right trade against holding an open descriptor to a file the
   * writer has moved.
   */
  async drain(deploymentId: string): Promise<ForgeRequestLogRecord[]> {
    const path = this.pathFor(deploymentId);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "r");
    } catch {
      return [];
    }

    try {
      const stats = await handle.stat();
      const { size } = stats;
      const cursor = this.#cursors.get(deploymentId);
      if (!cursor) {
        this.#cursors.set(deploymentId, {
          offset: size,
          partial: "",
          dev: stats.dev,
          ino: stats.ino,
        });
        return [];
      }
      // A different inode is a different file: Caddy rolled and this is the
      // replacement, so read it from the start. A shrink is the same conclusion
      // reached the other way, kept for a writer that truncates in place.
      if (
        stats.dev !== cursor.dev ||
        stats.ino !== cursor.ino ||
        size < cursor.offset
      ) {
        cursor.offset = 0;
        cursor.partial = "";
        cursor.dev = stats.dev;
        cursor.ino = stats.ino;
      }
      if (size === cursor.offset) return [];

      const records: ForgeRequestLogRecord[] = [];
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let offset = cursor.offset;
      let partial = cursor.partial;

      while (offset < size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(READ_CHUNK_BYTES, size - offset),
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
        partial += buffer.toString("utf8", 0, bytesRead);

        let newline = partial.indexOf("\n");
        while (newline !== -1) {
          const record = parseAccessLogLine(partial.slice(0, newline));
          if (record) records.push(record);
          partial = partial.slice(newline + 1);
          newline = partial.indexOf("\n");
        }
        // A "line" this long is not a log line. Dropping it keeps one corrupt
        // write from growing the buffer for the life of the process.
        if (partial.length > MAX_LINE_BYTES) partial = "";
      }

      cursor.offset = offset;
      cursor.partial = partial;
      return records;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  /**
   * The most recent `limit` requests, newest last.
   *
   * Reads backwards from the end so a 16 MB file does not have to be parsed to
   * show twenty rows.
   */
  async tail(
    deploymentId: string,
    limit: number,
  ): Promise<ForgeRequestLogRecord[]> {
    const path = this.pathFor(deploymentId);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "r");
    } catch {
      return [];
    }

    try {
      const { size } = await handle.stat();
      if (size === 0) return [];

      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let text = "";
      let position = size;
      let lines: string[] = [];

      while (position > 0) {
        const length = Math.min(READ_CHUNK_BYTES, position);
        position -= length;
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        text = buffer.toString("utf8", 0, bytesRead) + text;
        lines = text.split("\n");
        // The first element may be a partial line unless we reached the start.
        if (position === 0) break;
        if (lines.length - 1 > limit) break;
      }

      const complete = position === 0 ? lines : lines.slice(1);
      const records: ForgeRequestLogRecord[] = [];
      for (const line of complete.slice(-limit - 1)) {
        const record = parseAccessLogLine(line);
        if (record) records.push(record);
      }
      return records.slice(-limit);
    } finally {
      await handle.close().catch(() => {});
    }
  }
}
