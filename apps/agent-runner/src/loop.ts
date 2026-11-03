import {
  type ClaimedRun,
  RUNNER_CLAIM_INTERVAL_MS,
  type RunnerMergeCommand,
  type RunnerPrWatch,
} from "@repo/schemas";
import type { AdmissionDecision } from "./admission";
import type { Logger } from "./log";
import type { RunnerWebApi } from "./web-client";

const PR_WATCH_INTERVAL_MS = 60_000;

export interface RunnerLoopOptions {
  runnerId: string;
  web: Pick<RunnerWebApi, "claim">;
  /** Admission for a host with `live` runs already going. */
  admission: (live: number) => Promise<AdmissionDecision>;
  /** Supervises one run to completion; never expected to reject. */
  startRun: (run: ClaimedRun) => Promise<void>;
  merge: (command: RunnerMergeCommand) => Promise<void>;
  watchPr: (watch: RunnerPrWatch) => Promise<void>;
  log: Logger;
  intervalMs?: number;
  now?: () => number;
}

/**
 * The 15 s pull: one claim per tick carrying capacity and admission, then a
 * supervisor per claimed run. Web holds all state; this holds only which runs
 * it is supervising right now.
 */
export class RunnerLoop {
  readonly #live = new Map<string, Promise<void>>();
  readonly #busySprints = new Set<string>();
  readonly #lastWatch = new Map<string, number>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #ticking: Promise<void> | null = null;
  #stopped = true;

  constructor(private readonly options: RunnerLoopOptions) {}

  get liveCount(): number {
    return this.#live.size;
  }

  liveRunIds(): string[] {
    return [...this.#live.keys()];
  }

  /** A run supervised since before this loop started (boot re-attach). */
  adopt(runId: string, supervision: Promise<void>): void {
    this.#track(runId, supervision);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  /** Stops claiming. Runs keep going; their containers outlive the process. */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#ticking;
  }

  /** Settles when every supervised run has finished (tests, drains). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.#live.values()]);
  }

  async tick(): Promise<void> {
    const { web, log } = this.options;
    const live = this.#live.size;
    const decision = await this.options.admission(live);
    if (!decision.admissible && decision.capacity > 0) {
      log.debug("not admissible", { reasons: decision.reasons });
    }
    const response = await web.claim({
      runnerId: this.options.runnerId,
      capacity: decision.capacity,
      admissible: decision.admissible,
    });
    for (const run of response.runs) {
      if (this.#live.has(run.runId)) continue;
      log.info("claimed run", {
        runId: run.runId,
        kind: run.slot.kind,
        repo: run.sprint.repo,
      });
      this.#track(run.runId, this.options.startRun(run));
    }
    for (const command of response.commands) {
      this.#once(`merge:${command.sprintId}`, () =>
        this.options.merge(command),
      );
    }
    const now = (this.options.now ?? Date.now)();
    for (const watch of response.prWatches) {
      const last = this.#lastWatch.get(watch.sprintId) ?? 0;
      if (now - last < PR_WATCH_INTERVAL_MS) continue;
      this.#lastWatch.set(watch.sprintId, now);
      this.#once(`watch:${watch.sprintId}`, () => this.options.watchPr(watch));
    }
  }

  #track(runId: string, supervision: Promise<void>): void {
    const tracked = supervision
      .catch((error: unknown) => {
        this.options.log.error("run supervisor failed", {
          runId,
          error: String(error),
        });
      })
      .finally(() => this.#live.delete(runId));
    this.#live.set(runId, tracked);
  }

  #once(key: string, work: () => Promise<void>): void {
    if (this.#busySprints.has(key)) return;
    this.#busySprints.add(key);
    work()
      .catch((error: unknown) => {
        this.options.log.error("sprint command failed", {
          key,
          error: String(error),
        });
      })
      .finally(() => this.#busySprints.delete(key));
  }

  #schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#ticking = this.tick()
        .catch((error: unknown) => {
          this.options.log.warn("claim tick failed", { error: String(error) });
        })
        .finally(() => {
          this.#ticking = null;
          this.#schedule(this.options.intervalMs ?? RUNNER_CLAIM_INTERVAL_MS);
        });
    }, delay);
  }
}
