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
 * `create_file` is deliberately absent: Samba emits it for opening an existing
 * file as well as creating one — the disposition is a separate field — so
 * treating it as authorship would attribute a file to whoever last read it.
 * The narrower set costs nothing, because anything genuinely written also
 * produces a `pwrite`, and anything moved in produces a `renameat`.
 */
const AUTHORING_OPERATIONS = new Set([
  "pwrite",
  "write",
  "renameat",
  "mkdirat",
]);

/** The API's own broker share; those writes stamp their own identity. */
const EXCLUDED_SHARES = new Set(["ApiBroker"]);

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 20_000;

/**
 * Parses one `smbd_audit` line, or returns null if it is not one we can use.
 *
 * The path is taken as the last field rather than a fixed index because the
 * argument count varies per operation — and for `renameat` the last field is
 * the destination, which is exactly the path a move-in should be credited to.
 */
export function parseSmbAuditLine(line: string): ParsedAuditEvent | null {
  const body = line.includes("smbd_audit")
    ? line
        .slice(line.indexOf("smbd_audit") + "smbd_audit".length)
        .replace(/^[^|]*?:\s*/, "")
    : line;
  const fields = body.split("|");
  if (fields.length < 6) return null;

  const [principal, , share, operation, result] = fields;
  if (!principal || !share || !operation) return null;
  if (result !== "ok") return null;
  if (EXCLUDED_SHARES.has(share)) return null;
  if (!AUTHORING_OPERATIONS.has(operation)) return null;

  const absolutePath = fields[fields.length - 1]?.trim();
  if (!absolutePath?.startsWith("/")) return null;

  return { absolutePath, operation, principal, share };
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
