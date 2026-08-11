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

/**
 * How far back a filtered read will look before giving up.
 *
 * Without a cap, a filter matching nothing parses the whole file — 16 MB of
 * JSON per rolled log, on a Pi, while the caller holds a connection open. At
 * roughly 300 bytes a line this covers about 12 MB, so in practice it reaches
 * the start of a current log and stops short only on a full one.
 */
const MAX_SCAN_LINES = 40_000;

export interface RequestLogFilter {
  /** Upper-cased on entry; an empty list means every method. */
  methods?: readonly string[];
  /** `"2xx"`-style buckets; an empty list means every status. */
  statusClasses?: readonly string[];
  /** Substring, case-insensitive, over path + client + agent + status. */
  search?: string | null;
  minDurationMs?: number | null;
}

export interface RequestLogTail {
  requests: ForgeRequestLogRecord[];
  scanned: number;
  truncated: boolean;
}

/**
 * Compiled once per read rather than per line: a filtered scan can touch 40 000
 * records, and lower-casing the needle inside the loop is 40 000 allocations
 * for one constant.
 */
export function requestLogPredicate(
  filter: RequestLogFilter | undefined,
): (record: ForgeRequestLogRecord) => boolean {
  const methods = new Set(
    (filter?.methods ?? []).map((method) => method.toUpperCase()),
  );
  const classes = new Set(filter?.statusClasses ?? []);
  const needle = filter?.search?.trim().toLowerCase() ?? "";
  const minDuration = filter?.minDurationMs ?? null;
  if (
    methods.size === 0 &&
    classes.size === 0 &&
    needle.length === 0 &&
    minDuration === null
  ) {
    return () => true;
  }
  return (record) => {
    if (methods.size > 0 && !methods.has(record.method.toUpperCase())) {
      return false;
    }
    if (
      classes.size > 0 &&
      !classes.has(`${Math.floor(record.status / 100)}xx`)
    ) {
      return false;
    }
    if (minDuration !== null && record.durationMs < minDuration) return false;
    if (needle.length === 0) return true;
    return (
      record.uri.toLowerCase().includes(needle) ||
      record.clientIp.toLowerCase().includes(needle) ||
      String(record.status).includes(needle) ||
      (record.userAgent?.toLowerCase().includes(needle) ?? false) ||
      // Geo is searchable for the same reason the path is: "show me the 5xx
      // from Portugal" is a question worth one field rather than a filter.
      (record.geo.country?.toLowerCase().includes(needle) ?? false) ||
      (record.geo.city?.toLowerCase().includes(needle) ?? false) ||
      (record.geo.colo?.toLowerCase().includes(needle) ?? false)
    );
  };
}

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

/**
 * Caddy writes header names in the canonical casing it received them in, and
 * Cloudflare is not consistent about it — `CF-IPCity` and `Cf-Ipcity` both turn
 * up depending on which product set the header. Matching case-insensitively is
 * cheaper than being wrong for half of them.
 */
function firstHeader(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const direct = headers[name];
  const value =
    direct ??
    headers[
      Object.keys(headers).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      ) ?? ""
    ];
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}

function headerNumber(
  headers: Record<string, unknown> | undefined,
  name: string,
): number | null {
  const raw = firstHeader(headers, name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * `CF-Ray` is `<id>-<colo>`, e.g. `9a1f2c3d4e5f6789-LIS`. The colo is the
 * Cloudflare datacentre that took the request, which is the only part of the
 * header worth showing on its own.
 */
function parseRay(ray: string | null): {
  rayId: string | null;
  colo: string | null;
} {
  if (ray === null) return { rayId: null, colo: null };
  const separator = ray.lastIndexOf("-");
  if (separator <= 0) return { rayId: ray, colo: null };
  return {
    rayId: ray.slice(0, separator),
    colo: ray.slice(separator + 1) || null,
  };
}

/**
 * Cloudflare reports an address it cannot place as `XX` (and `T1` for Tor).
 * Both are the absence of an answer, not a country, and rendering them as one
 * puts a country called "XX" in the dashboard.
 */
function parseCountry(value: string | null): string | null {
  return value === null || value === "XX" || value === "T1" ? null : value;
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

  const headers = request.headers;
  // cloudflared speaks to Caddy over loopback, so `remote_ip` is the tunnel and
  // `client_ip` only differs from it when Caddy has trusted proxies configured
  // — which it does not. `CF-Connecting-IP` is therefore the only field on the
  // line that is ever a real visitor; the others stay as the fallback so a
  // request that reached Caddy some other way still reports something.
  const clientIp =
    firstHeader(headers, "CF-Connecting-IP") ??
    (typeof request.client_ip === "string"
      ? request.client_ip
      : typeof request.remote_ip === "string"
        ? request.remote_ip
        : "");

  const { rayId, colo } = parseRay(firstHeader(headers, "CF-Ray"));

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
    userAgent: firstHeader(headers, "User-Agent"),
    referer: firstHeader(headers, "Referer"),
    requestId: firstHeader(headers, "X-Request-Id"),
    rayId,
    geo: {
      country: parseCountry(firstHeader(headers, "CF-IPCountry")),
      city: firstHeader(headers, "CF-IPCity"),
      region: firstHeader(headers, "CF-Region"),
      continent: firstHeader(headers, "CF-IPContinent"),
      latitude: headerNumber(headers, "CF-IPLatitude"),
      longitude: headerNumber(headers, "CF-IPLongitude"),
      colo,
    },
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
   * The most recent `limit` requests matching `filter`, newest last.
   *
   * Reads backwards from the end so a 16 MB file does not have to be parsed to
   * show twenty rows, and — when a filter is set — keeps reading until it has
   * `limit` matches rather than stopping at the first `limit` lines. Filtering
   * the last page instead would answer "no 5xx here" for a deployment whose
   * errors are simply further back than the window, which is the only case
   * anyone opens this list to look for.
   *
   * `scanned` counts the lines actually parsed and `truncated` says the cap was
   * reached, so an empty result reads as "none in the last 40 000 requests"
   * rather than an unqualified nothing.
   */
  async tail(
    deploymentId: string,
    limit: number,
    filter?: RequestLogFilter,
  ): Promise<RequestLogTail> {
    const path = this.pathFor(deploymentId);
    const matches = requestLogPredicate(filter);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "r");
    } catch {
      return { requests: [], scanned: 0, truncated: false };
    }

    try {
      const { size } = await handle.stat();
      if (size === 0) return { requests: [], scanned: 0, truncated: false };

      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      // Newest first while scanning, reversed once at the end — unshifting into
      // an array that can hold `limit` entries is quadratic, and `limit` is 500.
      const found: ForgeRequestLogRecord[] = [];
      let scanned = 0;
      let truncated = false;
      let text = "";
      let position = size;
      let carry = "";

      while (position > 0 && found.length < limit && scanned < MAX_SCAN_LINES) {
        const length = Math.min(READ_CHUNK_BYTES, position);
        position -= length;
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        text = buffer.toString("utf8", 0, bytesRead) + carry;
        const lines = text.split("\n");
        // The first element is a partial line unless this chunk reached the
        // start of the file; it is carried into the next read rather than
        // parsed. Anything longer than one chunk is not a log line, and holding
        // it would grow the carry for the rest of the scan.
        carry = position === 0 ? "" : (lines.shift() ?? "");
        if (carry.length > MAX_LINE_BYTES) carry = "";
        if (position === 0 && lines.length === 0) break;

        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (found.length >= limit) break;
          if (scanned >= MAX_SCAN_LINES) {
            truncated = true;
            break;
          }
          const line = lines[index] ?? "";
          if (line.trim().length === 0) continue;
          scanned += 1;
          const record = parseAccessLogLine(line);
          if (record && matches(record)) found.push(record);
        }
      }

      // More file left with the budget spent means the answer is partial. A scan
      // that stopped because it filled `limit` is complete for what was asked.
      if (position > 0 && found.length < limit) truncated = true;
      return { requests: found.reverse(), scanned, truncated };
    } finally {
      await handle.close().catch(() => {});
    }
  }
}
