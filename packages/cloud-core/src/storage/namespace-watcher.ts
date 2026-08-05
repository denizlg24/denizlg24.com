import { type FSWatcher, watch } from "node:fs";

export type WatcherSignal =
  | { kind: "changed"; relativePath: string }
  | { kind: "overflow"; reason: string };

export interface WatcherOptions {
  root: string;
  onSignal: (signal: WatcherSignal) => void;
  /**
   * Coalescing window. SMB and editors produce bursts per logical change, and
   * the projector's SLA is measured in seconds, so debouncing costs nothing and
   * avoids re-listing a folder once per byte range written.
   */
  debounceMs?: number;
  /**
   * Distinct paths that may be pending before this declares overflow.
   *
   * Without a cap, copying a large tree in creates one live timer per path and
   * the debounce map grows with the copy. That is also exactly the case where
   * per-path signals are least useful and one full scan is cheapest, so hitting
   * the cap is treated as overflow rather than as backpressure to absorb.
   */
  maxPending?: number;
}

const DEFAULT_MAX_PENDING = 5_000;

/**
 * A low-latency change signal — explicitly *not* a source of truth.
 *
 * The plan is emphatic that no event stream is trusted for completeness, and
 * this one has three ways to lie: the kernel queue can overflow silently under
 * load, recursive watches miss directories created during setup, and a
 * withdrawn mount ends the watch without ending the namespace. Every one of
 * those surfaces as `overflow`, whose only correct handling is to mark the
 * projection dirty and schedule a full scan.
 *
 * It exists to make the common case fast, never to let a scan be skipped.
 */
export class NamespaceWatcher {
  #watcher: FSWatcher | null = null;
  #pending = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #debounceMs: number;
  readonly #maxPending: number;

  constructor(private readonly options: WatcherOptions) {
    this.#debounceMs = options.debounceMs ?? 250;
    this.#maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  }

  start(): void {
    if (this.#watcher) return;
    try {
      this.#watcher = watch(
        this.options.root,
        { recursive: true },
        (_event, filename) => {
          if (!filename) {
            // A null filename means the kernel could not tell us what changed,
            // which is indistinguishable from having missed events.
            this.options.onSignal({
              kind: "overflow",
              reason: "event-without-path",
            });
            return;
          }
          this.#queue(filename.toString());
        },
      );
      this.#watcher.on("error", (error) => {
        this.options.onSignal({
          kind: "overflow",
          reason: `watch-error: ${error.message}`,
        });
      });
      this.#watcher.on("close", () => {
        this.options.onSignal({ kind: "overflow", reason: "watch-closed" });
      });
    } catch (error) {
      // Recursive watch is unsupported on some platforms; that is a permanent
      // overflow rather than a reason to pretend the stream is healthy.
      this.options.onSignal({
        kind: "overflow",
        reason: `watch-unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  #queue(relativePath: string): void {
    const existing = this.#pending.get(relativePath);
    if (!existing && this.#pending.size >= this.#maxPending) {
      for (const timer of this.#pending.values()) clearTimeout(timer);
      this.#pending.clear();
      this.options.onSignal({
        kind: "overflow",
        reason: `pending-paths-exceeded-${this.#maxPending}`,
      });
      return;
    }
    if (existing) clearTimeout(existing);
    this.#pending.set(
      relativePath,
      setTimeout(() => {
        this.#pending.delete(relativePath);
        this.options.onSignal({ kind: "changed", relativePath });
      }, this.#debounceMs),
    );
  }

  stop(): void {
    for (const timer of this.#pending.values()) clearTimeout(timer);
    this.#pending.clear();
    const watcher = this.#watcher;
    this.#watcher = null;
    // Detach the close handler first: a deliberate stop is not an overflow.
    watcher?.removeAllListeners();
    watcher?.close();
  }
}
