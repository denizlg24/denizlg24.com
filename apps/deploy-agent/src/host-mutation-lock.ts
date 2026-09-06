import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function abortError(): Error {
  const error = new Error("host mutation lock acquisition was aborted");
  error.name = "AbortError";
  return error;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface HostMutationLockOptions {
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  /**
   * How long a lock whose holder is gone may sit before it is broken. Only
   * consulted once the recorded pid is known not to be running, so this is a
   * grace period against a half-published lock, not a hold limit.
   */
  staleGraceMs?: number;
  /** Injected so the reclaim path is testable without spawning processes. */
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * `kill(pid, 0)` sends no signal and only reports reachability. EPERM means the
 * process exists and belongs to someone else, which is still alive.
 */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * Serializes every Forge route/container mutation with the root-run backup.
 * The canonical directory itself is created with mkdir's no-replace semantics.
 * Ownership files follow immediately; backup tolerates that short publication
 * window and therefore neither implementation can replace the other's lock.
 */
export class HostMutationLock {
  readonly #path: string;
  readonly #timeoutMs: number;
  readonly #pollMs: number;
  readonly #now: () => number;
  readonly #staleGraceMs: number;
  readonly #isProcessAlive: (pid: number) => boolean;

  constructor(path: string, options: HostMutationLockOptions = {}) {
    if (
      !isAbsolute(path) ||
      normalize(path) !== path ||
      path === "/" ||
      path.endsWith("/") ||
      !path.endsWith(".lock") ||
      /[\r\n]/.test(path)
    ) {
      throw new Error(
        "host mutation lock must be a normalized absolute .lock path",
      );
    }
    this.#path = path;
    this.#timeoutMs = options.timeoutMs ?? 60 * 60_000;
    this.#pollMs = options.pollMs ?? 1_000;
    this.#now = options.now ?? Date.now;
    this.#staleGraceMs = options.staleGraceMs ?? 60_000;
    this.#isProcessAlive = options.isProcessAlive ?? processIsAlive;
  }

  async acquire(
    owner: string,
    signal: AbortSignal,
  ): Promise<() => Promise<void>> {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(owner)) {
      throw new Error("host mutation lock owner is unsafe");
    }
    const deadline = this.#now() + this.#timeoutMs;
    while (true) {
      if (signal.aborted) throw abortError();
      let acquired = false;
      try {
        await mkdir(this.#path, { mode: 0o770 });
        acquired = true;
        await writeFile(`${this.#path}/pid`, `${process.pid}\n`, {
          mode: 0o660,
        });
        await writeFile(`${this.#path}/owner`, `${owner}\n`, { mode: 0o660 });
        let released = false;
        return async () => {
          if (released) return;
          const [recordedOwner, recordedPid] = await Promise.all([
            readFile(`${this.#path}/owner`, "utf8"),
            readFile(`${this.#path}/pid`, "utf8"),
          ]);
          if (
            recordedOwner.trim() !== owner ||
            recordedPid.trim() !== String(process.pid)
          ) {
            throw new Error(
              "refusing to release a host mutation lock owned by another operation",
            );
          }
          // Rename is the release point. If the process dies while deleting the
          // tombstone, the canonical name is already available and the orphan
          // cannot be mistaken for a held lock by the backup process.
          const tombstone = `${this.#path}.released-${process.pid}-${randomUUID()}`;
          await rename(this.#path, tombstone);
          released = true;
          await rm(tombstone, { recursive: true, force: true });
        };
      } catch (error) {
        if (acquired) {
          await rm(this.#path, { recursive: true, force: true }).catch(
            () => {},
          );
          throw error;
        }
        const code = errorCode(error);
        if (code !== "EEXIST") throw error;
        // Retry immediately rather than sleeping out the poll: the lock is now
        // free and the next mkdir is the contest for it.
        if (await this.#reclaimIfAbandoned()) continue;
      }
      if (this.#now() >= deadline) {
        throw new Error(
          `timed out waiting for host mutation lock: ${this.#path}`,
        );
      }
      await wait(this.#pollMs, signal);
    }
  }

  /**
   * Breaks a lock whose holder is gone.
   *
   * Without this a leaked lock is absorbing: nothing on the host reclaims it,
   * every deployment and the garbage collector queue behind it for the full
   * hour `timeoutMs` allows, and then they fail. Recovering meant someone
   * noticing and removing a directory by hand.
   *
   * The test is deliberately narrow — the recorded pid is not running — because
   * the alternative, breaking on age, cannot tell a hung operation from a slow
   * one and would let two of them mutate the host at once. A lock leaked by a
   * process that is still alive is therefore still not reclaimed here; that is
   * a bug at the leak site, and this is the net for a crash.
   *
   * The break is a rename, the same publication point `release` uses, so two
   * agents racing to reclaim cannot both win.
   */
  async #reclaimIfAbandoned(): Promise<boolean> {
    let recordedPid: number;
    try {
      const raw = await readFile(`${this.#path}/pid`, "utf8");
      recordedPid = Number.parseInt(raw.trim(), 10);
    } catch {
      // No pid file yet. Either another acquisition is between its mkdir and
      // its first write, or it died in that window — indistinguishable, so the
      // grace period decides.
      return this.#breakIfOlderThanGrace();
    }
    if (!Number.isInteger(recordedPid) || recordedPid <= 0) {
      return this.#breakIfOlderThanGrace();
    }
    if (this.#isProcessAlive(recordedPid)) return false;
    return this.#break();
  }

  async #breakIfOlderThanGrace(): Promise<boolean> {
    try {
      const info = await stat(this.#path);
      if (this.#now() - info.mtimeMs < this.#staleGraceMs) return false;
    } catch {
      // Gone while we looked at it, which is the outcome we wanted anyway.
      return true;
    }
    return this.#break();
  }

  async #break(): Promise<boolean> {
    const tombstone = `${this.#path}.abandoned-${process.pid}-${randomUUID()}`;
    try {
      await rename(this.#path, tombstone);
    } catch {
      // Lost the race to another reclaimer, or the holder released first.
      return false;
    }
    await rm(tombstone, { recursive: true, force: true }).catch(() => {});
    return true;
  }

  async run<T>(
    owner: string,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(owner, signal);
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}
