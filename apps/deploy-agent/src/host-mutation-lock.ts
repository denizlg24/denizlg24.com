import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
      }
      if (this.#now() >= deadline) {
        throw new Error(
          `timed out waiting for host mutation lock: ${this.#path}`,
        );
      }
      await wait(this.#pollMs, signal);
    }
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
