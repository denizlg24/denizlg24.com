import {
  isReservedSegment,
  NamespaceWatcher,
  type NamespaceWatchMessage,
  watchPathToRelative,
} from "@repo/cloud-core";

export interface WatchBroadcasterOptions {
  debounceMs: number;
  maxPending: number;
  namespaceRoot: string;
  /** How long signals are gathered before one batch is sent. */
  flushMs: number;
}

/**
 * One recursive watch on the namespace, fanned out to every subscriber.
 *
 * A watch per subscriber would multiply inotify watches across the whole tree
 * for no benefit — every subscriber wants the same paths — and inotify watches
 * are a bounded kernel resource.
 *
 * Verified on the deployed host rather than assumed: a recursive watch on the
 * mergerfs mount does report writes arriving over SMB, including into
 * subdirectories created after the watch started. It does *not* report writes
 * made directly to a physical branch, which is one more reason the full scan
 * remains the authority on completeness.
 */
export class WatchBroadcaster {
  #subscribers = new Set<(message: NamespaceWatchMessage) => void>();
  #watcher: NamespaceWatcher | null = null;
  #batch = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #pendingOverflow: string | null = null;

  constructor(private readonly options: WatchBroadcasterOptions) {}

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  start(): void {
    if (this.#watcher) return;
    this.#watcher = new NamespaceWatcher({
      debounceMs: this.options.debounceMs,
      maxPending: this.options.maxPending,
      onSignal: (signal) => {
        if (signal.kind === "overflow") {
          // Batched paths are dropped: after an overflow the subscriber runs a
          // full scan, which subsumes anything still pending.
          this.#batch.clear();
          this.#pendingOverflow = signal.reason;
          this.#flush();
          return;
        }
        const relativePath = watchPathToRelative(
          signal.relativePath,
          isReservedSegment,
        );
        if (relativePath) this.#batch.add(relativePath);
      },
      root: this.options.namespaceRoot,
    });
    this.#watcher.start();
    this.#timer = setInterval(() => this.#flush(), this.options.flushMs);
    // The flush timer must not be what keeps the process alive.
    this.#timer.unref?.();
  }

  stop(): void {
    this.#watcher?.stop();
    this.#watcher = null;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#batch.clear();
  }

  subscribe(send: (message: NamespaceWatchMessage) => void): () => void {
    this.start();
    this.#subscribers.add(send);
    send({ type: "ready" });
    return () => {
      this.#subscribers.delete(send);
      // The watch is left running: subscribers reconnect, and tearing the watch
      // down between attempts would widen the gap each reconnect has to repair.
    };
  }

  #flush(): void {
    const overflow = this.#pendingOverflow;
    this.#pendingOverflow = null;
    if (overflow) {
      this.#broadcast({ reason: overflow, type: "overflow" });
      return;
    }
    if (this.#batch.size === 0) return;
    const paths = [...this.#batch];
    this.#batch.clear();
    this.#broadcast({ paths, type: "paths" });
  }

  #broadcast(message: NamespaceWatchMessage): void {
    for (const send of this.#subscribers) {
      try {
        send(message);
      } catch {
        this.#subscribers.delete(send);
      }
    }
  }
}
