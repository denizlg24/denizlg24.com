import { escapeXml } from "./xml";

export const DEFAULT_LOCK_TIMEOUT_SECONDS = 3_600;
export const MAX_LOCK_TIMEOUT_SECONDS = 24 * 3_600;

export interface DavLock {
  token: string;
  path: string;
  depth: "0" | "infinity";
  owner: string;
  timeoutSeconds: number;
  expiresAt: number;
  userId: string;
}

export interface CreateLockInput {
  path: string;
  depth: "0" | "infinity";
  owner: string;
  timeoutSeconds: number;
  userId: string;
}

/**
 * In-memory exclusive write locks.
 *
 * The API runs as a single process, so a Map is the whole truth — there is no
 * second replica to reconcile with. Locks are deliberately not persisted:
 * surviving a restart would strand a client's lock with no way to release it,
 * whereas losing them lets the client take a fresh one on its next write.
 */
export class DavLockStore {
  readonly #byToken = new Map<string, DavLock>();

  #sweep(now: number): void {
    for (const [token, lock] of this.#byToken) {
      if (lock.expiresAt <= now) this.#byToken.delete(token);
    }
  }

  create(input: CreateLockInput, now = Date.now()): DavLock {
    this.#sweep(now);
    const timeoutSeconds = clampTimeout(input.timeoutSeconds);
    const lock: DavLock = {
      token: `opaquelocktoken:${crypto.randomUUID()}`,
      path: input.path,
      depth: input.depth,
      owner: input.owner,
      timeoutSeconds,
      expiresAt: now + timeoutSeconds * 1_000,
      userId: input.userId,
    };
    this.#byToken.set(lock.token, lock);
    return lock;
  }

  get(token: string, now = Date.now()): DavLock | null {
    this.#sweep(now);
    return this.#byToken.get(token) ?? null;
  }

  refresh(
    token: string,
    timeoutSeconds: number,
    now = Date.now(),
  ): DavLock | null {
    const lock = this.get(token, now);
    if (!lock) return null;
    lock.timeoutSeconds = clampTimeout(timeoutSeconds);
    lock.expiresAt = now + lock.timeoutSeconds * 1_000;
    return lock;
  }

  remove(token: string): boolean {
    return this.#byToken.delete(token);
  }

  /**
   * The lock that governs `path` — either taken on it directly or inherited
   * from a depth-infinity lock on an ancestor.
   */
  covering(path: string, now = Date.now()): DavLock | null {
    this.#sweep(now);
    for (const lock of this.#byToken.values()) {
      if (lock.path === path) return lock;
      if (lock.depth === "infinity" && path.startsWith(`${lock.path}/`)) {
        return lock;
      }
    }
    return null;
  }

  /**
   * A write to `path` is refused when a lock covers it and the request did not
   * present that lock's token in its `If` header.
   */
  blocking(path: string, tokens: string[], now = Date.now()): DavLock | null {
    const lock = this.covering(path, now);
    if (!lock) return null;
    return tokens.includes(lock.token) ? null : lock;
  }

  /** Releases everything under a collection that has just been removed. */
  releaseSubtree(path: string): void {
    for (const [token, lock] of this.#byToken) {
      if (lock.path === path || lock.path.startsWith(`${path}/`)) {
        this.#byToken.delete(token);
      }
    }
  }

  /** Retargets locks after a MOVE so the client's token stays usable. */
  retargetSubtree(fromPath: string, toPath: string): void {
    for (const lock of this.#byToken.values()) {
      if (lock.path === fromPath) {
        lock.path = toPath;
      } else if (lock.path.startsWith(`${fromPath}/`)) {
        lock.path = `${toPath}${lock.path.slice(fromPath.length)}`;
      }
    }
  }

  get size(): number {
    return this.#byToken.size;
  }
}

function clampTimeout(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_LOCK_TIMEOUT_SECONDS;
  }
  return Math.min(Math.floor(seconds), MAX_LOCK_TIMEOUT_SECONDS);
}

/** `Timeout: Second-3600, Infinite` — the first usable value wins. */
export function parseTimeoutHeader(header: string | null | undefined): number {
  if (!header) return DEFAULT_LOCK_TIMEOUT_SECONDS;
  for (const raw of header.split(",")) {
    const value = raw.trim();
    if (/^infinite$/i.test(value)) return MAX_LOCK_TIMEOUT_SECONDS;
    const match = value.match(/^second-(\d+)$/i);
    if (match?.[1]) return clampTimeout(Number.parseInt(match[1], 10));
  }
  return DEFAULT_LOCK_TIMEOUT_SECONDS;
}

/**
 * Pulls the lock tokens out of an `If` header.
 *
 * The full RFC 4918 §10.4 grammar also carries ETag conditions and `Not`
 * clauses. Only the token list is honoured here: every token the client offers
 * is collected and matched against the locks actually held, which is what
 * decides whether a write proceeds. Conditions this does not model are treated
 * as satisfied rather than as failures, so an unusual header cannot lock a
 * client out of its own resource.
 */
export function parseIfHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/<([^>]+)>/g)]
    .map((match) => match[1] ?? "")
    .filter((token) => token.toLowerCase().startsWith("opaquelocktoken:"));
}

/** `Lock-Token: <opaquelocktoken:...>` */
export function parseLockTokenHeader(
  header: string | null | undefined,
): string | null {
  const match = header?.match(/<([^>]+)>/);
  return match?.[1] ?? null;
}

export function isLockRefresh(body: string): boolean {
  return body.trim().length === 0;
}

/**
 * Reads `<owner>` out of a LOCK body.
 *
 * The content is escaped rather than round-tripped as markup. RFC 4918 treats
 * owner as opaque XML, but storing client-supplied markup and replaying it into
 * every later lockdiscovery response makes this endpoint an echo for arbitrary
 * XML; no client does anything with the value beyond displaying it.
 */
export function parseLockOwner(body: string): string {
  const match = body.match(
    /<(?:[\w.-]+:)?owner(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?owner\s*>/i,
  );
  return match?.[1]?.trim() ?? "";
}

export function renderActiveLock(lock: DavLock, lockRootHref: string): string {
  return [
    "<D:activelock>",
    "<D:locktype><D:write/></D:locktype>",
    "<D:lockscope><D:exclusive/></D:lockscope>",
    `<D:depth>${lock.depth}</D:depth>`,
    lock.owner ? `<D:owner>${escapeXml(lock.owner)}</D:owner>` : "",
    `<D:timeout>Second-${lock.timeoutSeconds}</D:timeout>`,
    `<D:locktoken><D:href>${escapeXml(lock.token)}</D:href></D:locktoken>`,
    `<D:lockroot><D:href>${escapeXml(lockRootHref)}</D:href></D:lockroot>`,
    "</D:activelock>",
  ].join("");
}

export const SUPPORTED_LOCK_XML =
  "<D:lockentry><D:lockscope><D:exclusive/></D:lockscope>" +
  "<D:locktype><D:write/></D:locktype></D:lockentry>";
