import type {
  AgentDeploymentRequest,
  AgentDeploymentState,
  AgentQueueSnapshot,
  DeploymentPhase,
  DeploymentStatus,
  DeploymentStatusUpdate,
} from "@repo/schemas/cloud";

export interface RunnerContext {
  signal: AbortSignal;
  report: (update: DeploymentStatusUpdate) => Promise<void>;
  /**
   * Hands the build slot back while the run continues.
   *
   * Capacity exists to bound what a build costs — CPU, memory, and a spinning
   * disk that BuildKit reads and writes the whole time. None of that is still
   * true once the image exists: starting a container and polling it until it
   * answers is idle waiting, and a deployment already holds its memory whether
   * or not some other build is running. Holding a slot through it just leaves
   * the builder parked.
   *
   * Idempotent, and safe not to call — the run releases the slot on the way out
   * either way.
   */
  releaseBuildSlot: () => void;
}

export type DeploymentRunner = (
  request: AgentDeploymentRequest,
  context: RunnerContext,
) => Promise<DeploymentStatusUpdate>;

export interface QueueLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

export interface DeploymentQueueOptions {
  capacity: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  claim: () => Promise<AgentDeploymentRequest | null>;
  report: (
    deploymentId: string,
    update: DeploymentStatusUpdate,
  ) => Promise<void>;
  runner: DeploymentRunner;
  logger?: QueueLogger;
  now?: () => number;
  historyLimit?: number;
  /** How long stop() waits for in-flight runs to honour their abort signal. */
  stopGraceMs?: number;
  /**
   * Ceiling on total in-flight runs, build slot or not. Only reachable if the
   * post-build phase stalls — a health probe waiting out its timeout on a
   * container that never answers — and it exists so that stalling cannot claim
   * the whole queue and exhaust the port range behind it.
   */
  maxInFlight?: number;
}

export class QueueAtCapacityError extends Error {
  constructor() {
    super("Agent is at build capacity");
    this.name = "QueueAtCapacityError";
  }
}

interface RunningDeployment {
  request: AgentDeploymentRequest;
  controller: AbortController;
  state: AgentDeploymentState;
  holdsBuildSlot: boolean;
}

const NOOP_LOGGER: QueueLogger = { info: () => {}, error: () => {} };
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_STOP_GRACE_MS = 30_000;
/** Multiple of `capacity` that `maxInFlight` defaults to. */
const IN_FLIGHT_MULTIPLE = 4;
/**
 * Consecutive failed claims before the log level goes from info to error.
 *
 * The control plane being briefly unreachable is normal, not exceptional: it
 * restarts on every deploy, and in development the agent and the API start
 * together so the first few polls always lose the race — the API's runtime is
 * built lazily on the first `/api/*` request, which on a cold box takes longer
 * than the claim timeout. Logging all of that at error trains the reader to
 * ignore the one line that matters. At the default 3s poll this escalates
 * after roughly fifteen seconds of genuine unreachability.
 */
const CLAIM_FAILURES_BEFORE_ERROR = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The agent keeps no backlog of its own. The control plane's `deployments`
 * table is the queue, and this only ever holds what is actively running — so
 * an agent restart loses nothing, and two agents cannot disagree about what is
 * pending.
 */
export class DeploymentQueue {
  readonly #options: DeploymentQueueOptions;
  readonly #logger: QueueLogger;
  readonly #now: () => number;
  readonly #historyLimit: number;
  readonly #stopGraceMs: number;
  readonly #running = new Map<string, RunningDeployment>();
  readonly #history = new Map<string, AgentDeploymentState>();
  #started = false;
  #claimFailures = 0;
  #stopped = false;
  #loopPromise: Promise<void> | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #wake: (() => void) | null = null;
  #claimsInFlight = 0;
  #buildMaintenance = false;

  constructor(options: DeploymentQueueOptions) {
    this.#options = options;
    this.#logger = options.logger ?? NOOP_LOGGER;
    this.#now = options.now ?? Date.now;
    this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.#stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  }

  get capacity(): number {
    return this.#options.capacity;
  }

  get runningCount(): number {
    return this.#running.size;
  }

  /** In-flight runs still occupying a build slot. */
  get buildingCount(): number {
    let count = 0;
    for (const entry of this.#running.values()) {
      if (entry.holdsBuildSlot) count += 1;
    }
    return count;
  }

  get #maxInFlight(): number {
    return (
      this.#options.maxInFlight ?? this.#options.capacity * IN_FLIGHT_MULTIPLE
    );
  }

  /**
   * Both bounds, as one question. The build slots are the real limit; the
   * in-flight ceiling only ever bites when something after the build is stuck.
   */
  get #hasRoom(): boolean {
    return (
      !this.#buildMaintenance &&
      this.buildingCount < this.#options.capacity &&
      this.#running.size < this.#maxInFlight
    );
  }

  /**
   * Pauses new claims while an operation needs exclusive access to BuildKit.
   *
   * This is deliberately a try-acquire rather than a wait: an hourly cache
   * prune is disposable and must not queue ahead of deployments already using
   * the worker. When the worker is idle, setting the flag and checking it are
   * synchronous, so a build cannot slip in between them.
   */
  tryAcquireBuildMaintenance(): (() => void) | null {
    if (
      this.#stopped ||
      this.#buildMaintenance ||
      this.#claimsInFlight > 0 ||
      this.buildingCount > 0
    ) {
      return null;
    }
    this.#buildMaintenance = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#buildMaintenance = false;
      this.#wake?.();
    };
  }

  snapshot(): AgentQueueSnapshot {
    return {
      running: this.#running.size,
      capacity: this.#options.capacity,
      building: this.buildingCount,
      deploymentIds: [...this.#running.keys()],
    };
  }

  get(deploymentId: string): AgentDeploymentState | null {
    return (
      this.#running.get(deploymentId)?.state ??
      this.#history.get(deploymentId) ??
      null
    );
  }

  list(): AgentDeploymentState[] {
    return [
      ...[...this.#running.values()].map((entry) => entry.state),
      ...this.#history.values(),
    ];
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#heartbeatTimer = setInterval(() => {
      void this.#beat();
    }, this.#options.heartbeatIntervalMs);
    this.#loopPromise = this.#loop();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (!this.#started) return;
    this.#started = false;
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    for (const entry of this.#running.values()) {
      entry.controller.abort();
    }
    this.#wake?.();
    await this.#loopPromise;
    this.#loopPromise = null;
  }

  /**
   * Claims until full or until the control plane has nothing left. Separate
   * from the loop so tests can drive exactly one pass without timers.
   */
  async pump(): Promise<void> {
    while (!this.#stopped && this.#hasRoom) {
      this.#claimsInFlight += 1;
      let request: AgentDeploymentRequest | null;
      try {
        request = await this.#options.claim();
      } finally {
        this.#claimsInFlight -= 1;
      }
      if (!request) return;
      this.#launch(request);
    }
  }

  /**
   * The manual path (`POST /deployments`). It refuses at capacity rather than
   * queueing locally: a second queue on this side would be invisible to the
   * control plane and would survive a restart differently from the real one.
   */
  submit(request: AgentDeploymentRequest): AgentDeploymentState {
    // Idempotency is checked before capacity, not after: a retried POST for a
    // deployment already running is not a request for a new slot, and at
    // capacity one — which is the default — the order decides whether the retry
    // succeeds or spuriously 429s.
    const existing = this.#running.get(request.deploymentId);
    if (existing) return existing.state;
    if (this.#stopped || !this.#hasRoom) {
      throw new QueueAtCapacityError();
    }
    return this.#launch(request);
  }

  cancel(deploymentId: string): boolean {
    const entry = this.#running.get(deploymentId);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  #launch(request: AgentDeploymentRequest): AgentDeploymentState {
    const controller = new AbortController();
    const timestamp = new Date(this.#now()).toISOString();
    const state: AgentDeploymentState = {
      deploymentId: request.deploymentId,
      status: "building",
      phase: null,
      hostname: request.hostname,
      port: null,
      imageTag: null,
      containerId: null,
      error: null,
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    const entry: RunningDeployment = {
      request,
      controller,
      state,
      holdsBuildSlot: true,
    };
    this.#running.set(request.deploymentId, entry);
    this.#logger.info("deployment started", {
      deploymentId: request.deploymentId,
      hostname: request.hostname,
    });
    void this.#run(entry);
    return state;
  }

  async #run(entry: RunningDeployment): Promise<void> {
    const { deploymentId } = entry.request;
    const report = async (update: DeploymentStatusUpdate): Promise<void> => {
      this.#applyUpdate(entry, update);
      await this.#options.report(deploymentId, update);
    };

    try {
      const final = await this.#options.runner(entry.request, {
        signal: entry.controller.signal,
        releaseBuildSlot: () => this.#releaseBuildSlot(entry),
        report: async (update) => {
          try {
            await report(update);
          } catch (error) {
            // A control-plane blip must not fail a build that is otherwise
            // fine. The next report, or the heartbeat, re-synchronises.
            this.#logger.error("progress report failed", {
              deploymentId,
              error: errorMessage(error),
            });
          }
        },
      });
      await report(final);
    } catch (error) {
      const cancelled = entry.controller.signal.aborted;
      const update: DeploymentStatusUpdate = cancelled
        ? { status: "cancelled" }
        : { status: "failed", error: errorMessage(error) };
      this.#applyUpdate(entry, update);
      this.#logger.error(
        cancelled ? "deployment cancelled" : "deployment failed",
        {
          deploymentId,
          error: errorMessage(error),
        },
      );
      try {
        await this.#options.report(deploymentId, update);
      } catch (reportError) {
        // The run is over either way. Losing the final report leaves a row the
        // interrupted sweep reclaims, which is strictly better than hanging on
        // to the slot waiting for a control plane that is not answering.
        this.#logger.error("final report failed", {
          deploymentId,
          error: errorMessage(reportError),
        });
      }
    } finally {
      // A run that failed before reaching the deploy phase still holds its
      // slot, and one that released it early must not release it twice.
      entry.holdsBuildSlot = false;
      this.#running.delete(deploymentId);
      this.#remember(entry.state);
      // Do not wait out the poll interval for a slot that is free now.
      this.#wake?.();
    }
  }

  #releaseBuildSlot(entry: RunningDeployment): void {
    if (!entry.holdsBuildSlot) return;
    entry.holdsBuildSlot = false;
    this.#logger.info("build slot released", {
      deploymentId: entry.request.deploymentId,
      building: this.buildingCount,
      running: this.#running.size,
    });
    this.#wake?.();
  }

  #applyUpdate(entry: RunningDeployment, update: DeploymentStatusUpdate): void {
    const state = entry.state;
    state.status = update.status satisfies DeploymentStatus;
    state.updatedAt = new Date(this.#now()).toISOString();
    if (update.phase !== undefined) {
      state.phase = (update.phase ?? null) satisfies DeploymentPhase | null;
    }
    if (update.port !== undefined) state.port = update.port ?? null;
    if (update.imageTag !== undefined) state.imageTag = update.imageTag ?? null;
    if (update.containerId !== undefined) {
      state.containerId = update.containerId ?? null;
    }
    if (update.error !== undefined) state.error = update.error ?? null;
  }

  #remember(state: AgentDeploymentState): void {
    this.#history.set(state.deploymentId, { ...state });
    while (this.#history.size > this.#historyLimit) {
      const oldest = this.#history.keys().next();
      if (oldest.done) break;
      this.#history.delete(oldest.value);
    }
  }

  async #beat(): Promise<void> {
    for (const entry of this.#running.values()) {
      try {
        await this.#options.report(entry.request.deploymentId, {
          status: entry.state.status,
          phase: entry.state.phase,
        });
      } catch (error) {
        this.#logger.error("heartbeat failed", {
          deploymentId: entry.request.deploymentId,
          error: errorMessage(error),
        });
      }
    }
  }

  async #loop(): Promise<void> {
    while (this.#started) {
      try {
        await this.pump();
        if (this.#claimFailures > 0) {
          this.#logger.info("control plane reachable", {
            afterFailures: this.#claimFailures,
          });
          this.#claimFailures = 0;
        }
      } catch (error) {
        this.#claimFailures += 1;
        const fields = {
          error: errorMessage(error),
          consecutive: this.#claimFailures,
        };
        if (this.#claimFailures >= CLAIM_FAILURES_BEFORE_ERROR) {
          this.#logger.error("claim failed", fields);
        } else {
          this.#logger.info("claim failed", fields);
        }
      }
      if (!this.#started) break;
      await this.#idle(this.#options.pollIntervalMs);
    }
    // Let in-flight runs settle so stop() resolves against a drained queue —
    // but bounded. A runner that ignores its abort signal would otherwise hang
    // shutdown forever and leave systemd to SIGKILL us, which loses the final
    // status report for every other deployment that did stop cleanly.
    const deadline = this.#now() + this.#stopGraceMs;
    while (this.#running.size > 0 && this.#now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.#running.size > 0) {
      this.#logger.error("stopped with deployments still in flight", {
        deploymentIds: [...this.#running.keys()],
      });
    }
  }

  #idle(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.#wake = finish;
    });
  }
}
