import type { NamespaceMetadataClient } from "./metadata-client";
import { type ApplierSource, applyWatchedPaths } from "./namespace-applier";
import type { ProjectionRepository } from "./namespace-projector";

export interface NamespaceSyncOptions {
  client: NamespaceMetadataClient;
  repository: ProjectionRepository;
  source: ApplierSource;
  /** Runs a deterministic full scan. Supplied so the supervisor owns no scan policy. */
  requestFullScan(reason: string): Promise<void>;
  /**
   * Runs after a batch reaches PostgreSQL — search indexing, in practice.
   * A failure here is logged and does not mark the projection dirty: the
   * database is already correct, and a stale search document is a far smaller
   * problem than a scan storm.
   */
  afterApply?(): Promise<unknown>;
  /** Reconnect backoff bounds. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * Floor between full-scan requests.
   *
   * A scan is the response to every way the watch can lose events, so a watch
   * that flaps asks for one on every cycle. Without a floor that is a scan
   * storm: the projection is repeatedly rebuilt, each run competing with the
   * next, and the condition that caused the flapping is never the thing that
   * gets attention. Skipping a request is safe because the projection stays
   * marked dirty, so the next scan still knows it is owed.
   */
  minScanIntervalMs?: number;
  onEvent?(event: NamespaceSyncEvent): void;
}

export interface NamespaceSyncEvent {
  type:
    | "connected"
    | "disconnected"
    | "overflow"
    | "applied"
    | "index-failed"
    | "scan-requested"
    | "scan-throttled"
    | "scan-failed";
  detail?: string;
  applied?: { upserted: number; removed: number; withheld: number };
}

const DEFAULT_MIN_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_MIN_SCAN_INTERVAL_MS = 60_000;

/**
 * Keeps the projection current between full scans.
 *
 * The invariant is that the projection is never *silently* stale. Every way
 * this can lose events — the stream dropping, the host restarting, the watcher
 * overflowing, a batch failing to apply — converges on the same response: mark
 * the projection dirty and ask for a full scan. That makes the watcher a
 * latency optimisation that is allowed to fail, rather than a second source of
 * truth that must not.
 *
 * A full scan is also requested on first connect. The watcher can say nothing
 * about what changed while nobody was subscribed, and the API having just
 * started is exactly when that window is longest.
 */
export class NamespaceSyncSupervisor {
  #abort: AbortController | null = null;
  #running = false;
  #backoffMs: number;
  #lastAppliedAt: number | null = null;
  #dirtySince: number | null = null;
  #lastScanRequestedAt = 0;

  constructor(private readonly options: NamespaceSyncOptions) {
    this.#backoffMs = options.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
  }

  /** Milliseconds since the last successful apply, for health reporting. */
  get idleMs(): number | null {
    return this.#lastAppliedAt === null
      ? null
      : Date.now() - this.#lastAppliedAt;
  }

  get dirtySince(): number | null {
    return this.#dirtySince;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#loop();
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#abort?.abort();
    this.#abort = null;
  }

  async #markDirtyAndScan(reason: string, force = false): Promise<void> {
    this.#dirtySince ??= Date.now();
    await this.options.repository.setDirty(true, reason).catch(() => {});

    const interval =
      this.options.minScanIntervalMs ?? DEFAULT_MIN_SCAN_INTERVAL_MS;
    const since = Date.now() - this.#lastScanRequestedAt;
    if (!force && since < interval) {
      // Dirty is already recorded, so the debt is not lost — only the extra
      // scan that would have raced the one just requested.
      this.options.onEvent?.({ detail: reason, type: "scan-throttled" });
      return;
    }
    this.#lastScanRequestedAt = Date.now();
    this.options.onEvent?.({ detail: reason, type: "scan-requested" });
    try {
      await this.options.requestFullScan(reason);
      this.#dirtySince = null;
    } catch (error) {
      this.options.onEvent?.({
        detail: error instanceof Error ? error.message : String(error),
        type: "scan-failed",
      });
    }
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      const abort = new AbortController();
      this.#abort = abort;
      let connected = false;
      try {
        for await (const message of this.options.client.watch(abort.signal)) {
          if (!this.#running) break;
          if (message.type === "ready") {
            connected = true;
            this.#backoffMs =
              this.options.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
            this.options.onEvent?.({ type: "connected" });
            // Covers the unsubscribed window, whose length is unknown here.
            await this.#markDirtyAndScan("watch-connected");
            continue;
          }
          if (message.type === "overflow") {
            this.options.onEvent?.({
              detail: message.reason,
              type: "overflow",
            });
            await this.#markDirtyAndScan(`watch-overflow:${message.reason}`);
            continue;
          }
          const outcome = await applyWatchedPaths(
            this.options.source,
            this.options.repository,
            message.paths,
          ).catch(async (error) => {
            await this.#markDirtyAndScan(
              `apply-failed:${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          });
          if (!outcome) continue;
          await this.options.afterApply?.().catch((error) => {
            this.options.onEvent?.({
              detail: error instanceof Error ? error.message : String(error),
              type: "index-failed",
            });
          });
          this.#lastAppliedAt = Date.now();
          this.options.onEvent?.({
            applied: {
              removed: outcome.removed,
              upserted: outcome.upserted,
              withheld: outcome.withheld,
            },
            type: "applied",
          });
          // Withheld paths are entries the watcher believes are gone but the
          // branch check would not confirm. The scan is the only thing allowed
          // to resolve that.
          if (outcome.withheld > 0 || outcome.problems > 0) {
            await this.#markDirtyAndScan("apply-withheld");
          }
        }
      } catch (error) {
        this.options.onEvent?.({
          detail: error instanceof Error ? error.message : String(error),
          type: "disconnected",
        });
      }

      if (!this.#running) return;
      if (connected) {
        this.options.onEvent?.({ type: "disconnected" });
      }
      // Any end of stream is an unaccounted gap, including a clean one — but
      // only the dirty mark is needed here. The reconnect scans on `ready`,
      // and scanning on both ends of one cycle doubles the work for a window
      // the reconnect already covers.
      await this.options.repository
        .setDirty(true, "watch-disconnected")
        .catch(() => {});
      this.#dirtySince ??= Date.now();
      await new Promise((resolve) => setTimeout(resolve, this.#backoffMs));
      this.#backoffMs = Math.min(
        this.#backoffMs * 2,
        this.options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      );
    }
  }
}
