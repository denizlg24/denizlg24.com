/**
 * Reading authorship out of Samba's `full_audit` stream.
 *
 * This exists because nothing else can answer "who wrote this". Every share
 * sets `force user`, so the file records uid 1000 whoever created it, and a
 * file dropped straight into the shared root has no owned ancestor to inherit
 * from either — only the shared root itself, which is deliberately ownerless.
 * The audit line is the one place the authenticated principal survives.
 *
 * It is evidence, never proof. The stream is a log: it rotates, it is lost
 * across a restart, and a file that predates the window has no entry. Callers
 * must treat a miss as "unknown" and fall back, never as "nobody".
 */

/** `%u|%I|%S` followed by the operation, its result, its arguments, and a path. */
export interface ParsedAuditEvent {
  absolutePath: string;
  operation: string;
  principal: string;
  share: string;
}

export interface RecentWriter {
  at: number;
  principal: string;
}

/**
 * Operations that make the actor an author rather than a reader.
 *
 * Notably not the write calls. Modern Samba writes through `pwrite_send` /
 * `pwrite_recv`, so auditing plain `pwrite` logs nothing at all — and auditing
 * the async pair logs one line per *chunk*, which turns a single large upload
 * into tens of thousands of journal entries. `create_file` is one line per
 * file and is already enabled, so it is both the cheaper signal and the only
 * one being emitted.
 */
const AUTHORING_OPERATIONS = new Set(["renameat", "mkdirat"]);

/**
 * Create dispositions that mean the actor brought the entry into existence.
 *
 * `create_file` covers opening an existing file as well as creating one, and
 * the disposition is what separates them — without this check the index would
 * credit a file to whoever last *read* it. `open` is the read case and is the
 * only one excluded; `open_if` creates when the entry is absent, which is what
 * a macOS client uses for a new file.
 */
const CREATING_DISPOSITIONS = new Set([
  "create",
  "open_if",
  "overwrite",
  "overwrite_if",
  "supersede",
]);

/** The API's own broker share; those writes stamp their own identity. */
const EXCLUDED_SHARES = new Set(["ApiBroker"]);

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 20_000;

/** The `%U|%I|%S|…` body of a line, with any syslog prefix removed. */
function auditFields(line: string): string[] {
  const body = line.includes("smbd_audit")
    ? line
        .slice(line.indexOf("smbd_audit") + "smbd_audit".length)
        .replace(/^[^|]*?:\s*/, "")
    : line;
  return body.split("|");
}

/**
 * Parses one `smbd_audit` line, or returns null if it is not one we can use.
 *
 * The path is taken as the last field rather than a fixed index because the
 * argument count varies per operation — and for `renameat` the last field is
 * the destination, which is exactly the path a move-in should be credited to.
 */
export function parseSmbAuditLine(line: string): ParsedAuditEvent | null {
  const fields = auditFields(line);
  if (fields.length < 6) return null;

  const [principal, , share, operation, result] = fields;
  if (!principal || !share || !operation) return null;
  if (result !== "ok") return null;
  if (EXCLUDED_SHARES.has(share)) return null;
  if (operation === "create_file") {
    // `…|create_file|ok|<access mask>|<type>|<disposition>|<path>`
    const disposition = fields[fields.length - 2];
    if (!disposition || !CREATING_DISPOSITIONS.has(disposition)) return null;
  } else if (!AUTHORING_OPERATIONS.has(operation)) {
    return null;
  }

  const absolutePath = fields[fields.length - 1]?.trim();
  if (!absolutePath?.startsWith("/")) return null;

  return { absolutePath, operation, principal, share };
}

/** `%U|%I|%S|connect|ok|<share>`: a device authenticated and opened a share. */
export interface ParsedConnectEvent {
  from: string;
  principal: string;
  share: string;
}

export interface RecentConnection {
  at: number;
  from: string;
  share: string;
}

/**
 * Parses a `connect` audit line, or returns null for anything else.
 *
 * This is the only place a successful SMB sign-in is recorded anywhere:
 * `smb_credentials.last_authenticated_at` is written by nothing else, and the
 * device page's "Connected ✓" is built on it. Failed connects are audited too
 * and deliberately ignored — a mistyped password is not a connection.
 */
export function parseSmbConnectLine(line: string): ParsedConnectEvent | null {
  const fields = auditFields(line);
  if (fields.length < 5) return null;
  const [principal, from, share, operation, result] = fields;
  if (!principal || !from || !share) return null;
  if (operation !== "connect" || result !== "ok") return null;
  if (EXCLUDED_SHARES.has(share)) return null;
  return { from: from.trim(), principal, share };
}

/**
 * The most recent successful connection per principal.
 *
 * One entry per device credential, so it needs no eviction: the bound is the
 * number of credentials that have ever connected since the service started,
 * and a principal that is revoked simply stops being asked about.
 */
export class RecentConnectionIndex {
  readonly #entries = new Map<string, RecentConnection>();

  get size(): number {
    return this.#entries.size;
  }

  record(event: ParsedConnectEvent, now = Date.now()): void {
    this.#entries.set(event.principal, {
      at: now,
      from: event.from,
      share: event.share,
    });
  }

  connectionOf(principal: string): RecentConnection | null {
    return this.#entries.get(principal) ?? null;
  }

  snapshot(): { at: number; from: string; principal: string; share: string }[] {
    return [...this.#entries].map(([principal, entry]) => ({
      principal,
      ...entry,
    }));
  }
}

/** One live session as `smbstatus -b` reports it. */
export interface OpenSmbSession {
  from: string;
  principal: string;
}

/**
 * Parses the brief session table `smbstatus -b` prints.
 *
 * The table is `PID Username Group Machine …` under a dashed rule; the machine
 * column is `<ip> (ipv4:<ip>:<port>)`, so the first token is the address.
 * Header, rule and version lines have no leading PID and are skipped, which
 * also makes an empty table parse to an empty list rather than a failure.
 */
export function parseSmbstatusBrief(output: string): OpenSmbSession[] {
  const sessions: OpenSmbSession[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (!match) continue;
    const [, , principal, , from] = match;
    if (!principal || !from) continue;
    sessions.push({ from, principal });
  }
  return sessions;
}

/**
 * The most recent authoring principal per namespace path.
 *
 * Bounded on both axes because it is fed by an unbounded stream: a large copy
 * would otherwise grow it per file forever. Entries are only needed between a
 * write and the adoption that follows it, which is seconds on the watch path
 * and one scan interval at worst, so a short TTL loses nothing that matters.
 */
export class RecentWriterIndex {
  readonly #entries = new Map<string, RecentWriter>();
  readonly #maxEntries: number;
  readonly #namespaceRoot: string;
  readonly #ttlMs: number;

  constructor(options: {
    namespaceRoot: string;
    maxEntries?: number;
    ttlMs?: number;
  }) {
    this.#namespaceRoot = options.namespaceRoot.replace(/\/+$/, "");
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Namespace-relative form of a host path, or null if it is outside the namespace. */
  toRelative(absolutePath: string): string | null {
    if (absolutePath === this.#namespaceRoot) return "/";
    const prefix = `${this.#namespaceRoot}/`;
    if (!absolutePath.startsWith(prefix)) return null;
    const relative = absolutePath.slice(prefix.length).replace(/\/+$/, "");
    return relative.length === 0 ? "/" : relative;
  }

  record(event: ParsedAuditEvent, now = Date.now()): void {
    const relativePath = this.toRelative(event.absolutePath);
    if (!relativePath || relativePath === "/") return;
    // Re-inserting moves the key to the end of the Map's iteration order, which
    // is what makes the eviction below oldest-first rather than arbitrary.
    this.#entries.delete(relativePath);
    this.#entries.set(relativePath, { at: now, principal: event.principal });
    this.#evict(now);
  }

  writerOf(relativePath: string, now = Date.now()): RecentWriter | null {
    const found = this.#entries.get(relativePath.replace(/^\/+/, ""));
    if (!found) return null;
    if (now - found.at > this.#ttlMs) {
      this.#entries.delete(relativePath.replace(/^\/+/, ""));
      return null;
    }
    return found;
  }

  #evict(now: number): void {
    for (const [path, entry] of this.#entries) {
      if (
        this.#entries.size <= this.#maxEntries &&
        now - entry.at <= this.#ttlMs
      ) {
        break;
      }
      this.#entries.delete(path);
    }
  }
}
