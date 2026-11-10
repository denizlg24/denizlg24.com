import { appendFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ClaimedRun,
  type CodingRunCi,
  type CodingRunFailure,
  type CodingRunUsage,
  RUNNER_HEARTBEAT_INTERVAL_MS,
  type RunnerCompleteRequestInput,
  type RunnerHeartbeatResponse,
  type RunResult,
} from "@repo/schemas";
import type { RunnerConfig } from "./config";
import { type ContainerSpec, type Docker, RUN_LABEL } from "./docker";
import {
  appendRunRow,
  type CiWaitOptions,
  type GitHubClient,
  initialPullBody,
  planReview,
  postReview,
  type RunRow,
  type RunTokenSource,
  TokenFile,
  waitForCi,
} from "./github";
import type {
  HarnessAdapter,
  HarnessOutcome,
  HarnessStream,
} from "./harness/types";
import { sleep as realSleep } from "./http";
import type { Logger } from "./log";
import { TranscriptSink } from "./transcript";
import type { RunnerWebApi } from "./web-client";
import {
  CONTAINER_CREDS,
  CONTAINER_OUT,
  CONTAINER_USER,
  type FinalizeOutcome,
  type PreparedWorkspace,
  type RunPaths,
  type RunState,
  readResult,
  readRunState,
  runPaths,
  type Workspaces,
  writeRunState,
} from "./workspace";

const FLUSH_INTERVAL_MS = 2_000;
const STOP_GRACE_SECONDS = 20;
/** Past the deadline: the stop, the kill, and a slow daemon answering. */
const WAIT_GRACE_MS = 5 * 60_000;

export type GitHubFactory = (
  token: () => string,
) => Pick<
  GitHubClient,
  | "getPull"
  | "findOpenPull"
  | "createPull"
  | "updatePullBody"
  | "markReady"
  | "pullFiles"
  | "createReview"
  | "checkRuns"
  | "combinedStatus"
  | "requiredChecks"
>;

export interface RunTokenFile {
  readonly path: string;
  start(): Promise<void>;
  stop(): void;
  token(): string;
}

export interface RunDeps {
  config: Pick<
    RunnerConfig,
    "root" | "image" | "containerRuntime" | "network" | "git"
  >;
  runnerVersion: string;
  web: RunnerWebApi;
  docker: Pick<
    Docker,
    "runDetached" | "wait" | "logs" | "stop" | "kill" | "remove" | "state"
  >;
  workspaces: Pick<
    Workspaces,
    | "createCredsDir"
    | "prepare"
    | "writeContext"
    | "finalize"
    | "resolvConfMount"
  >;
  runTokens: Pick<RunTokenSource, "mint">;
  github: GitHubFactory;
  harness: HarnessAdapter;
  log: Logger;
  tokenFile?: (run: ClaimedRun, credsDir: string) => RunTokenFile;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
  flushMs?: number;
  ci?: Pick<CiWaitOptions, "intervalMs" | "timeoutMs" | "graceMs">;
  onFinished?: (runId: string) => void;
}

export function containerName(runId: string): string {
  return `agent-run-${runId}`;
}

// ── Pure decisions ─────────────────────────────────────────────────────────

export interface ExitSignals {
  abandoned: boolean;
  cancelled: boolean;
  timedOut: boolean;
  /** Why supervision ended without the container's exit, if it did. */
  supervisionError: string | null;
  exitCode: number;
  outcome: HarnessOutcome | null;
  stderrTail: string;
  timeoutMinutes: number;
}

export type ExitClass =
  | { kind: "abandon" }
  | { kind: "cancelled" }
  | { kind: "failed"; failure: CodingRunFailure }
  | { kind: "exited" };

/**
 * How the container ended, before anything looks at the worktree. An auth
 * failure arrives as a `result` with is_error set but subtype "success", so
 * is_error alone decides.
 */
export function classifyExit(signals: ExitSignals): ExitClass {
  if (signals.abandoned) return { kind: "abandon" };
  if (signals.cancelled) return { kind: "cancelled" };
  if (signals.timedOut) {
    return {
      kind: "failed",
      failure: {
        code: "timeout",
        message: `The run passed its ${signals.timeoutMinutes}-minute limit and was stopped`,
      },
    };
  }
  // Ahead of the stream: a result already read says nothing about the
  // container the runner could no longer follow, and finishing on it would
  // push and report a run nobody saw end.
  if (signals.supervisionError) {
    return {
      kind: "failed",
      failure: {
        code: "runner-lost",
        message:
          `The runner lost the container: ${signals.supervisionError}`.slice(
            0,
            8_000,
          ),
      },
    };
  }
  if (signals.outcome?.isError) {
    return {
      kind: "failed",
      failure: {
        code: "harness-error",
        message: (
          signals.outcome.text ||
          `Claude Code ended with ${signals.outcome.subtype}`
        ).slice(0, 8_000),
      },
    };
  }
  if (!signals.outcome) {
    const tail = signals.stderrTail.trim().slice(-4_000);
    return {
      kind: "failed",
      failure: {
        code: "harness-error",
        message: `Claude Code exited ${signals.exitCode} without a result${tail ? `: ${tail}` : ""}`,
      },
    };
  }
  return { kind: "exited" };
}

export type ReattachDecision = "reattach" | "remove";

/** What boot does with a labelled container it finds. */
export function decideReattach(
  heartbeat: RunnerHeartbeatResponse | null,
  state: RunState | null,
): ReattachDecision {
  if (!state || state.completedAt !== undefined) return "remove";
  if (heartbeat && !heartbeat.live) return "remove";
  return "reattach";
}

export function usageFrom(
  outcome: HarnessOutcome | null,
  credential: ClaimedRun["config"]["credential"],
): CodingRunUsage | undefined {
  if (!outcome) return undefined;
  return {
    ...outcome.usage,
    costUsd: outcome.totalCostUsd,
    notional: credential === "subscription",
  };
}

function rowFor(run: ClaimedRun, result: RunResult): RunRow {
  return {
    slot: run.slot.title,
    kind: run.slot.kind,
    status:
      run.slot.kind === "review" && result.kind === "review"
        ? result.verdict
        : run.slot.kind === "release"
          ? "prepared"
          : "succeeded",
    summary: result.summary,
  };
}

function envFileContent(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      if (/[\r\n]/.test(value)) {
        throw new Error(`Environment value for ${key} spans lines`);
      }
      return `${key}=${value}`;
    })
    .join("\n");
}

// ── Supervisor ─────────────────────────────────────────────────────────────

interface Control {
  abandoned: boolean;
  cancelled: boolean;
  timedOut: boolean;
}

export class RunSupervisor {
  constructor(private readonly deps: RunDeps) {}

  #now(): number {
    return (this.deps.now ?? Date.now)();
  }

  #sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? realSleep)(ms);
  }

  #tokenFile(run: ClaimedRun, credsDir: string): RunTokenFile {
    if (this.deps.tokenFile) return this.deps.tokenFile(run, credsDir);
    return new TokenFile(
      this.deps.runTokens,
      run.sprint.repo,
      run.slot.kind,
      credsDir,
      (error) =>
        this.deps.log.warn("token refresh failed", {
          runId: run.runId,
          error: String(error),
        }),
    );
  }

  /** A freshly claimed run, from workspace to completion. Never rejects. */
  async start(run: ClaimedRun): Promise<void> {
    const { deps } = this;
    const paths = runPaths(deps.config.root, run);
    let credsDir = "";
    try {
      credsDir = await deps.workspaces.createCredsDir(run.runId);
    } catch (error) {
      await this.#complete(run, {
        status: "failed",
        failure: { code: "workspace-error", message: String(error) },
      });
      return;
    }
    const startedAt = this.#now();
    const state: RunState = {
      run,
      containerName: containerName(run.runId),
      credsDir,
      startedAt,
      deadline: startedAt + run.config.timeoutMinutes * 60_000,
      milestones: {},
    };
    await writeRunState(paths.state, state);
    const tokenFile = this.#tokenFile(run, credsDir);
    let prepared: PreparedWorkspace;
    try {
      await tokenFile.start();
      prepared = await deps.workspaces.prepare(run, paths, credsDir);
      await deps.workspaces.writeContext(run, paths, prepared);
    } catch (error) {
      tokenFile.stop();
      await this.#complete(run, {
        status: "failed",
        failure: {
          code: "workspace-error",
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 8_000),
        },
      });
      await this.#markDone(paths, state, false);
      return;
    }
    state.git = {
      head: prepared.head,
      mergeBase: prepared.mergeBase,
      baseTip: prepared.baseTip,
    };
    await writeRunState(paths.state, state);
    await this.#withRetry("start", () =>
      deps.web.start(run.runId, {
        baseSha: prepared.head,
        workspacePath: paths.worktree,
        runnerVersion: deps.runnerVersion,
        harnessVersion: deps.harness.version,
      }),
    ).catch((error: unknown) =>
      deps.log.warn("start not acknowledged", {
        runId: run.runId,
        error: String(error),
      }),
    );
    try {
      const command = deps.harness.command({
        run,
        paths: {
          out: CONTAINER_OUT,
          context: `${CONTAINER_OUT}/context/SPRINT.md`,
          findings: `${CONTAINER_OUT}/context/findings.json`,
          result: `${CONTAINER_OUT}/result.json`,
        },
        git: state.git,
        identity: deps.config.git,
      });
      await writeFile(paths.envFile, envFileContent(command.env), {
        mode: 0o600,
      });
      try {
        await deps.docker.runDetached(
          this.#containerSpec(
            run,
            paths,
            credsDir,
            command.entrypoint,
            command.args,
          ),
        );
      } finally {
        await rm(paths.envFile, { force: true });
      }
    } catch (error) {
      tokenFile.stop();
      await this.#complete(run, {
        status: "failed",
        failure: {
          code: "harness-error",
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 8_000),
        },
      });
      await this.#markDone(paths, state, false);
      return;
    }
    await this.#supervise(state, paths, tokenFile);
  }

  /** A run whose container outlived a runner restart. */
  async reattach(state: RunState): Promise<void> {
    const paths = runPaths(this.deps.config.root, state.run);
    const tokenFile = this.#tokenFile(state.run, state.credsDir);
    try {
      await tokenFile.start();
    } catch (error) {
      this.deps.log.warn("re-attached run has no GitHub token yet", {
        runId: state.run.runId,
        error: String(error),
      });
    }
    await this.#supervise(state, paths, tokenFile);
  }

  #containerSpec(
    run: ClaimedRun,
    paths: RunPaths,
    credsDir: string,
    entrypoint: string,
    args: string[],
  ): ContainerSpec {
    const { config, workspaces } = this.deps;
    return {
      name: containerName(run.runId),
      image: config.image,
      runtime: config.containerRuntime,
      network: config.network,
      user: CONTAINER_USER,
      labels: { [RUN_LABEL]: run.runId },
      memory: "8g",
      memorySwap: "8g",
      cpus: 4,
      pidsLimit: 4096,
      readOnly: true,
      tmpfs: ["/tmp:rw,exec,nosuid,size=4g"],
      mounts: [
        { source: paths.worktree, target: paths.worktree },
        { source: paths.mirror, target: paths.mirror },
        { source: paths.out, target: CONTAINER_OUT },
        { source: credsDir, target: CONTAINER_CREDS, readOnly: true },
        { source: join(config.root, "cache", "bun"), target: "/cache/bun" },
        workspaces.resolvConfMount,
      ],
      workdir: paths.worktree,
      envFile: paths.envFile,
      entrypoint,
      command: args,
    };
  }

  async #supervise(
    state: RunState,
    paths: RunPaths,
    tokenFile: RunTokenFile,
  ): Promise<void> {
    const { deps } = this;
    const { run } = state;
    const name = state.containerName;
    const control: Control = {
      abandoned: false,
      cancelled: false,
      timedOut: false,
    };
    const stream = deps.harness.stream();
    const sink = new TranscriptSink(run.runId, deps.web, deps.now);
    let stopping: Promise<void> | null = null;
    const stopContainer = () => {
      stopping ??= (async () => {
        await deps.docker.stop(name, STOP_GRACE_SECONDS).catch(() => {});
        // Kill unless the container is confirmed down: an unreadable state
        // after a failed stop must not leave the wait below running forever.
        const status = await deps.docker.state(name);
        if (status !== "exited" && status !== "dead") {
          await deps.docker.kill(name);
        }
      })().catch((error: unknown) =>
        deps.log.warn("stopping container failed", {
          runId: run.runId,
          error: String(error),
        }),
      );
      return stopping;
    };

    let active = true;
    const heartbeat = this.#loop(
      deps.heartbeatMs ?? RUNNER_HEARTBEAT_INTERVAL_MS,
      () => active,
      async () => {
        const beat = await deps.web.heartbeat(run.runId);
        if (!beat.live && !control.abandoned) {
          control.abandoned = true;
          await stopContainer();
        } else if (beat.cancelRequested && !control.cancelled) {
          control.cancelled = true;
          stream.notice("info", "Cancelled from the sprint page.");
          await stopContainer();
        }
      },
    );
    const deadlineTimer = setTimeout(
      () => {
        control.timedOut = true;
        stream.notice(
          "warning",
          `Stopped at the ${run.config.timeoutMinutes}-minute limit.`,
        );
        void stopContainer();
      },
      Math.max(0, state.deadline - this.#now()),
    );
    const flusher = this.#loop(
      deps.flushMs ?? FLUSH_INTERVAL_MS,
      () => active,
      async () => {
        sink.add(stream.takeDirty());
        if (sink.size > 0) await sink.flush();
      },
    );

    let exitCode = -1;
    let stderrTail = "";
    let supervisionError: string | null = null;
    try {
      const logs = deps.docker.logs(name);
      await writeFile(paths.stream, "");
      const consume = (async () => {
        for await (const chunk of logs.stdout) {
          stream.push(chunk);
          await appendFile(paths.stream, chunk).catch(() => {});
        }
      })();
      // Bounded by the run's own deadline, never by when this supervisor
      // started: a re-attach after a runner restart gets the same end.
      exitCode = await deps.docker.wait(name, {
        timeoutMs: Math.max(0, state.deadline - this.#now()) + WAIT_GRACE_MS,
      });
      await Promise.race([consume, this.#sleep(10_000)]);
      logs.kill();
      stderrTail = await Promise.race([
        logs.stderrTail(),
        this.#sleep(2_000).then(() => ""),
      ]);
    } catch (error) {
      deps.log.error("supervising container failed", {
        runId: run.runId,
        error: String(error),
      });
      supervisionError = String(error);
    } finally {
      clearTimeout(deadlineTimer);
      stream.end();
    }

    const exit = classifyExit({
      ...control,
      supervisionError,
      exitCode,
      outcome: stream.outcome(),
      stderrTail,
      timeoutMinutes: run.config.timeoutMinutes,
    });

    let request: RunnerCompleteRequestInput | null = null;
    if (exit.kind === "cancelled") {
      request = {
        status: "cancelled",
        usage: usageFrom(stream.outcome(), run.config.credential),
      };
    } else if (exit.kind === "failed") {
      request = {
        status: "failed",
        failure: exit.failure,
        usage: usageFrom(stream.outcome(), run.config.credential),
      };
    } else if (exit.kind === "exited") {
      request = await this.#afterExit(state, paths, tokenFile, stream, control);
    }

    sink.add(stream.takeDirty());
    await sink.flush().catch((error: unknown) =>
      deps.log.warn("final transcript flush failed", {
        runId: run.runId,
        error: String(error),
      }),
    );
    if (request && !control.abandoned) {
      if (control.cancelled && request.status !== "cancelled") {
        request = { ...request, status: "cancelled", failure: undefined };
      }
      await this.#complete(run, request);
    }
    active = false;
    await Promise.allSettled([heartbeat, flusher]);
    tokenFile.stop();
    await deps.docker.remove(name).catch(() => {});
    await this.#markDone(paths, state, request?.status === "cancelled");
  }

  /** The runner's half after a clean exit: result, commit, push, PR, review, CI. */
  async #afterExit(
    state: RunState,
    paths: RunPaths,
    tokenFile: RunTokenFile,
    stream: HarnessStream,
    control: Control,
  ): Promise<RunnerCompleteRequestInput> {
    const { deps } = this;
    const { run } = state;
    const usage = usageFrom(stream.outcome(), run.config.credential);
    const read = await readResult(paths.result, run.slot.kind);
    if (!read.ok) {
      return {
        status: "failed",
        failure: { code: "no-result", message: read.reason },
        usage,
      };
    }
    const result = read.result;
    const pushes = run.slot.kind !== "review";

    let finalized: FinalizeOutcome;
    try {
      finalized = await deps.workspaces.finalize(run, paths, state.credsDir, {
        commit: pushes,
        push: pushes,
      });
    } catch (error) {
      return {
        status: "failed",
        failure: {
          code: "workspace-error",
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 8_000),
        },
        usage,
        result,
      };
    }
    if (finalized.committed) {
      stream.notice("info", "Committed what the agent left uncommitted.");
    }
    if (finalized.push === "rejected") {
      stream.notice("warning", "GitHub refused the push.");
      return {
        status: "failed",
        failure: {
          code: "push-rejected",
          message: finalized.pushError || "git push was rejected",
        },
        headSha: finalized.head,
        usage,
        result,
      };
    }
    const pushed = finalized.push === "ok" || state.milestones.pushed === true;
    if (finalized.push === "ok") {
      state.milestones.pushed = true;
      await writeRunState(paths.state, state);
    }

    const github = deps.github(() => tokenFile.token());
    let pr: { number: number; url: string } | null = null;
    try {
      pr = await this.#ensurePull(
        state,
        paths,
        github,
        result,
        finalized.ahead > 0 && pushed,
      );
    } catch (error) {
      stream.notice(
        "warning",
        `Pull request not updated: ${String(error)}`.slice(0, 2_000),
      );
    }

    const base: RunnerCompleteRequestInput = {
      status: "succeeded",
      result,
      headSha: finalized.head,
      usage,
      pushed,
      prNumber: pr?.number,
      prUrl: pr?.url,
    };

    if (result.kind === "review") {
      if (!pr) {
        stream.notice("warning", "No pull request to post the review on.");
      } else if (!state.milestones.reviewPosted) {
        try {
          const files = await github.pullFiles(run.sprint.repo, pr.number);
          await postReview(
            github,
            run.sprint.repo,
            pr.number,
            finalized.head,
            planReview(result, files),
          );
          state.milestones.reviewPosted = true;
          await writeRunState(paths.state, state);
        } catch (error) {
          stream.notice(
            "warning",
            `Review not posted: ${String(error)}`.slice(0, 2_000),
          );
        }
      }
      return base;
    }

    if (result.kind !== "release") return base;

    if (!pr) {
      return {
        ...base,
        status: "failed",
        failure: {
          code: "workspace-error",
          message: "The release has no pull request to offer",
        },
      };
    }
    if (!state.milestones.readyMarked) {
      try {
        const pull = await github.getPull(run.sprint.repo, pr.number);
        if (pull.draft) await github.markReady(pull.node_id);
        state.milestones.readyMarked = true;
        await writeRunState(paths.state, state);
      } catch (error) {
        stream.notice(
          "warning",
          `Could not mark the PR ready: ${String(error)}`.slice(0, 2_000),
        );
      }
    }
    stream.notice("info", "Waiting for CI on the release commit.");
    const outcome = await waitForCi({
      client: github,
      repo: run.sprint.repo,
      sha: finalized.head,
      baseBranch: run.sprint.baseBranch,
      ciRequired: result.ciRequired,
      cancelled: () => control.cancelled || control.abandoned,
      now: deps.now,
      sleep: deps.sleep,
      ...deps.ci,
    }).catch((error: unknown) => ({
      kind: "timeout" as const,
      ci: {
        state: "pending" as const,
        checkedAt: new Date(this.#now()).toISOString(),
      } satisfies CodingRunCi,
      message: `Reading CI failed: ${String(error)}`,
    }));
    if (outcome.kind === "cancelled") return { ...base, status: "cancelled" };
    if (outcome.kind === "success") return { ...base, ci: outcome.ci };
    return {
      ...base,
      status: "failed",
      ci: outcome.ci,
      failure: { code: "ci-failed", message: outcome.message.slice(0, 8_000) },
    };
  }

  async #ensurePull(
    state: RunState,
    paths: RunPaths,
    github: ReturnType<GitHubFactory>,
    result: RunResult,
    canOpen: boolean,
  ): Promise<{ number: number; url: string } | null> {
    const { run } = state;
    const row = rowFor(run, result);
    let number = state.milestones.prNumber ?? run.sprint.prNumber;
    let url = state.milestones.prUrl ?? run.sprint.prUrl;
    if (!number) {
      const existing = await github.findOpenPull(
        run.sprint.repo,
        run.sprint.branch,
      );
      if (existing) {
        number = existing.number;
        url = existing.html_url;
      } else if (canOpen) {
        const created = await github.createPull(run.sprint.repo, {
          title: run.sprint.title,
          head: run.sprint.branch,
          base: run.sprint.baseBranch,
          body: initialPullBody(run.sprint.goal, row),
        });
        state.milestones.prNumber = created.number;
        state.milestones.prUrl = created.html_url;
        state.milestones.rowAppended = true;
        await writeRunState(paths.state, state);
        return { number: created.number, url: created.html_url };
      } else {
        return null;
      }
    }
    if (!url || !state.milestones.rowAppended) {
      const pull = await github.getPull(run.sprint.repo, number);
      url = pull.html_url;
      if (!state.milestones.rowAppended) {
        await github.updatePullBody(
          run.sprint.repo,
          number,
          appendRunRow(pull.body ?? "", row),
        );
        state.milestones.rowAppended = true;
      }
    }
    state.milestones.prNumber = number;
    state.milestones.prUrl = url;
    await writeRunState(paths.state, state);
    return { number, url };
  }

  async #complete(
    run: ClaimedRun,
    request: RunnerCompleteRequestInput,
  ): Promise<void> {
    await this.#withRetry("complete", () =>
      this.deps.web.complete(run.runId, request),
    ).catch((error: unknown) =>
      this.deps.log.error(
        "completion never reached web; the lease will lapse",
        {
          runId: run.runId,
          error: String(error),
        },
      ),
    );
  }

  async #markDone(
    paths: RunPaths,
    state: RunState,
    removeNow: boolean,
  ): Promise<void> {
    const current = (await readRunState(paths.state)) ?? state;
    await writeRunState(paths.state, {
      ...current,
      milestones: { ...current.milestones, ...state.milestones },
      completedAt: this.#now(),
      removeNow,
    });
    await rm(state.credsDir, { recursive: true, force: true }).catch(() => {});
    this.deps.onFinished?.(state.run.runId);
  }

  async #withRetry(what: string, work: () => Promise<void>): Promise<void> {
    const delays = [2_000, 5_000, 15_000, 30_000, 60_000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        await work();
        return;
      } catch (error) {
        const delay = delays[attempt];
        if (delay === undefined) throw error;
        this.deps.log.warn(`${what} failed; retrying`, {
          error: String(error),
        });
        await this.#sleep(delay);
      }
    }
  }

  /** Runs `tick` every `ms` until `running()` turns false; errors are logged. */
  async #loop(
    ms: number,
    running: () => boolean,
    tick: () => Promise<void>,
  ): Promise<void> {
    while (running()) {
      try {
        await tick();
      } catch (error) {
        this.deps.log.warn("periodic run task failed", {
          error: String(error),
        });
      }
      const until = this.#now() + ms;
      while (running() && this.#now() < until) {
        await realSleep(Math.min(250, ms));
      }
    }
  }
}
