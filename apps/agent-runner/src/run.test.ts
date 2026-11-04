import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ClaimedRun,
  RunnerCompleteRequestInput,
  RunnerEventsRequest,
  RunnerHeartbeatResponse,
} from "@repo/schemas";
import type { ContainerSpec } from "./docker";
import type { StreamingProcess } from "./exec";
import type { Pull } from "./github";
import { ClaudeCodeHarness } from "./harness/claude-code";
import { silentLogger } from "./log";
import { recoverRuns } from "./recovery";
import {
  classifyExit,
  decideReattach,
  type GitHubFactory,
  RunSupervisor,
} from "./run";
import { claimedRun } from "./test-fixtures";
import type { RunnerWebApi } from "./web-client";
import {
  type FinalizeOutcome,
  type RunState,
  readRunState,
  runPaths,
  writeRunState,
} from "./workspace";

const FIXTURES = join(import.meta.dir, "../../../packages/utils/src/fixtures");
const HEAD = "e".repeat(40);
const BASE = "f".repeat(40);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-runner-"));
  await mkdir(join(root, "state"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function streamOf(text: string, exitCode = 0): StreamingProcess {
  return {
    stdout: (async function* () {
      yield text;
    })(),
    stderrTail: async () => "",
    exited: Promise.resolve(exitCode),
    kill: () => {},
  };
}

function fakeWeb(
  heartbeat: RunnerHeartbeatResponse = { cancelRequested: false, live: true },
) {
  const completes: RunnerCompleteRequestInput[] = [];
  const events: RunnerEventsRequest[] = [];
  const starts: string[] = [];
  const web: RunnerWebApi = {
    claim: async () => ({ runs: [], commands: [], prWatches: [] }),
    start: async (runId) => {
      starts.push(runId);
    },
    heartbeat: async () => heartbeat,
    events: async (_runId, request) => {
      events.push(request);
    },
    complete: async (_runId, request) => {
      completes.push(request);
    },
    mergeResult: async () => {},
    prState: async () => {},
  };
  return { web, completes, events, starts };
}

function pull(overrides: Partial<Pull> = {}): Pull {
  return {
    number: 7,
    node_id: "PR_node",
    html_url: "https://github.com/denizlg24/sprint-e2e/pull/7",
    state: "open",
    draft: true,
    body: "",
    head: { sha: HEAD },
    ...overrides,
  };
}

function fakeGitHub() {
  const calls: string[] = [];
  const factory: GitHubFactory = () => ({
    getPull: async () => {
      calls.push("getPull");
      return pull();
    },
    findOpenPull: async () => {
      calls.push("findOpenPull");
      return null;
    },
    createPull: async (_repo, input) => {
      calls.push(`createPull:${input.head}->${input.base}`);
      return pull();
    },
    updatePullBody: async () => {
      calls.push("updatePullBody");
      return pull();
    },
    markReady: async () => {
      calls.push("markReady");
    },
    pullFiles: async () => [],
    createReview: async (_repo, _number, review) => {
      calls.push(`createReview:${review.event}`);
    },
    checkRuns: async () => ({ check_runs: [] }),
    combinedStatus: async () => ({ statuses: [] }),
    requiredChecks: async () => null,
  });
  return { factory, calls };
}

interface Scenario {
  run?: ClaimedRun;
  fixture?: string;
  result?: unknown;
  finalize?: FinalizeOutcome;
  heartbeat?: RunnerHeartbeatResponse;
}

async function execute(scenario: Scenario) {
  const run = scenario.run ?? claimedRun();
  const stdout = await readFile(
    join(FIXTURES, scenario.fixture ?? "claude-stream.jsonl"),
    "utf8",
  );
  const { web, completes, events, starts } = fakeWeb(scenario.heartbeat);
  const github = fakeGitHub();
  const specs: ContainerSpec[] = [];
  const finalizeCalls: Array<{ commit: boolean; push: boolean }> = [];
  const removed: string[] = [];
  const supervisor = new RunSupervisor({
    config: {
      root,
      image: "img@sha256:x",
      containerRuntime: "runsc",
      network: "agent-runs",
      git: { name: "Sprint Agent", email: "sprint@denizlg24.com" },
    },
    runnerVersion: "test",
    web,
    docker: {
      runDetached: async (spec) => {
        specs.push(spec);
        const env = await readFile(spec.envFile ?? "", "utf8");
        expect(env).toContain("CLAUDE_CODE_OAUTH_TOKEN=");
        return "container-id";
      },
      wait: async () => 0,
      logs: () => streamOf(stdout),
      stop: async () => {},
      kill: async () => {},
      remove: async (name) => {
        removed.push(name);
      },
      state: async () => "exited",
    },
    workspaces: {
      resolvConfMount: {
        source: join(root, "resolv.conf"),
        target: "/etc/resolv.conf",
        readOnly: true,
      },
      createCredsDir: async (runId) => {
        const dir = join(root, "creds", runId);
        await mkdir(dir, { recursive: true });
        return dir;
      },
      prepare: async (claimed, paths) => {
        await mkdir(paths.context, { recursive: true });
        if (scenario.result !== undefined) {
          await writeFile(
            paths.result,
            typeof scenario.result === "string"
              ? scenario.result
              : JSON.stringify(scenario.result),
          );
        }
        expect(claimed.runId).toBe(run.runId);
        return { head: BASE, baseTip: BASE, mergeBase: BASE, created: true };
      },
      writeContext: async () => {},
      finalize: async (_run, _paths, _creds, options) => {
        finalizeCalls.push(options);
        return (
          scenario.finalize ?? {
            head: HEAD,
            committed: false,
            ahead: 1,
            push: options.push ? "ok" : "skipped",
          }
        );
      },
    },
    runTokens: {
      mint: async () => ({
        token: "ghs",
        expiresAt: Date.now() + 3_600_000,
        permissions: {},
      }),
    },
    github: github.factory,
    harness: new ClaudeCodeHarness({
      subscriptionToken: "sk-ant-oat01-x",
      gatewayBaseUrl: "https://ai-gateway.vercel.sh",
    }),
    log: silentLogger,
    tokenFile: (_run, dir) => ({
      path: join(dir, "github-token"),
      start: async () => {},
      stop: () => {},
      token: () => "ghs",
    }),
    sleep: async () => {},
    heartbeatMs: 10,
    flushMs: 10,
    ci: { graceMs: 0, intervalMs: 0, timeoutMs: 0 },
  });
  await supervisor.start(run);
  const state = await readRunState(runPaths(root, run).state);
  return {
    completes,
    events,
    starts,
    specs,
    finalizeCalls,
    removed,
    github: github.calls,
    state,
  };
}

const IMPLEMENT_RESULT = {
  kind: "implement",
  summary: "Added hello.txt.",
  changedAreas: ["hello.txt"],
  testsRun: [],
};

describe("RunSupervisor", () => {
  test("a clean implement run pushes, opens a draft PR and succeeds", async () => {
    const outcome = await execute({ result: IMPLEMENT_RESULT });
    expect(outcome.starts).toHaveLength(1);
    expect(outcome.finalizeCalls).toEqual([{ commit: true, push: true }]);
    expect(outcome.github).toEqual([
      "findOpenPull",
      "createPull:sprint/e2e-ab12->main",
    ]);
    const complete = outcome.completes[0];
    expect(complete).toMatchObject({
      status: "succeeded",
      headSha: HEAD,
      pushed: true,
      prNumber: 7,
      prUrl: "https://github.com/denizlg24/sprint-e2e/pull/7",
    });
    expect(complete?.usage?.notional).toBe(true);
    expect(outcome.events.length).toBeGreaterThan(0);
    expect(outcome.removed).toEqual([`agent-run-${claimedRun().runId}`]);
    expect(outcome.state?.completedAt).toBeDefined();
  });

  test("the container gets the run's limits and mounts", async () => {
    const { specs } = await execute({ result: IMPLEMENT_RESULT });
    const spec = specs[0];
    expect(spec).toMatchObject({
      runtime: "runsc",
      network: "agent-runs",
      user: "1000:1000",
      memory: "8g",
      memorySwap: "8g",
      cpus: 4,
      pidsLimit: 4096,
      readOnly: true,
      entrypoint: "claude",
    });
    expect(spec?.labels).toEqual({ "agent-runner.run": claimedRun().runId });
    expect(
      spec?.mounts?.find((mount) => mount.target === "/run/creds")?.readOnly,
    ).toBe(true);
  });

  test("no result.json fails as no-result even on exit 0, and nothing is pushed", async () => {
    const outcome = await execute({});
    expect(outcome.completes[0]).toMatchObject({
      status: "failed",
      failure: { code: "no-result" },
    });
    expect(outcome.finalizeCalls).toEqual([]);
  });

  test("an invalid result.json is no-result", async () => {
    const outcome = await execute({
      result: { kind: "implement", summary: "" },
    });
    expect(outcome.completes[0]?.failure?.code).toBe("no-result");
  });

  test("a result for another kind is no-result", async () => {
    const outcome = await execute({
      result: { kind: "custom", summary: "Did something else." },
    });
    expect(outcome.completes[0]?.failure?.message).toContain("custom result");
  });

  test("a rejected push fails as push-rejected with git's message", async () => {
    const outcome = await execute({
      result: IMPLEMENT_RESULT,
      finalize: {
        head: HEAD,
        committed: true,
        ahead: 2,
        push: "rejected",
        pushError: "! [rejected] HEAD -> sprint/e2e-ab12 (non-fast-forward)",
      },
    });
    expect(outcome.completes[0]).toMatchObject({
      status: "failed",
      failure: { code: "push-rejected" },
      headSha: HEAD,
    });
    expect(outcome.completes[0]?.failure?.message).toContain(
      "non-fast-forward",
    );
    expect(outcome.github).toEqual([]);
  });

  test("an auth failure is harness-error although its subtype is success", async () => {
    const outcome = await execute({
      fixture: "claude-auth-error.jsonl",
      result: IMPLEMENT_RESULT,
    });
    expect(outcome.completes[0]).toMatchObject({
      status: "failed",
      failure: { code: "harness-error" },
    });
    expect(outcome.finalizeCalls).toEqual([]);
  });

  test("a review neither commits nor pushes, and posts its findings", async () => {
    const run = claimedRun({
      sprint: { ...claimedRun().sprint, prNumber: 7 },
      slot: { ...claimedRun().slot, kind: "review" },
    });
    const outcome = await execute({
      run,
      result: {
        kind: "review",
        summary: "Looks fine.",
        verdict: "approve",
        findings: [],
      },
      finalize: { head: HEAD, committed: false, ahead: 1, push: "skipped" },
    });
    expect(outcome.finalizeCalls).toEqual([{ commit: false, push: false }]);
    expect(outcome.github).toContain("createReview:COMMENT");
    expect(outcome.completes[0]).toMatchObject({
      status: "succeeded",
      pushed: false,
    });
  });

  test("a release marks the PR ready and succeeds without CI when none is required", async () => {
    const run = claimedRun({
      sprint: { ...claimedRun().sprint, prNumber: 7 },
      slot: { ...claimedRun().slot, kind: "release" },
    });
    const outcome = await execute({
      run,
      result: {
        kind: "release",
        summary: "Nothing to bump.",
        steps: [],
        ciRequired: false,
      },
    });
    expect(outcome.github).toContain("markReady");
    expect(outcome.completes[0]).toMatchObject({
      status: "succeeded",
      ci: { state: "success" },
    });
  });

  test("a heartbeat that says not live stops the run without completing it", async () => {
    const outcome = await execute({
      result: IMPLEMENT_RESULT,
      heartbeat: { cancelRequested: false, live: false },
    });
    expect(outcome.completes).toEqual([]);
  });

  test("a cancel completes as cancelled and marks the workspace for removal", async () => {
    const outcome = await execute({
      result: IMPLEMENT_RESULT,
      heartbeat: { cancelRequested: true, live: true },
    });
    expect(outcome.completes[0]?.status).toBe("cancelled");
    expect(outcome.state?.removeNow).toBe(true);
  });
});

describe("classifyExit", () => {
  const base = {
    abandoned: false,
    cancelled: false,
    timedOut: false,
    exitCode: 0,
    outcome: {
      isError: false,
      subtype: "success",
      text: "done",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      totalCostUsd: 0.01,
    },
    stderrTail: "",
    timeoutMinutes: 90,
  };

  test("a timeout wins over whatever the stream said", () => {
    expect(classifyExit({ ...base, timedOut: true })).toMatchObject({
      kind: "failed",
      failure: { code: "timeout" },
    });
  });

  test("a crash without a result event is a harness error with stderr", () => {
    expect(
      classifyExit({
        ...base,
        outcome: null,
        exitCode: 137,
        stderrTail: "Killed",
      }),
    ).toMatchObject({
      kind: "failed",
      failure: {
        code: "harness-error",
        message: "Claude Code exited 137 without a result: Killed",
      },
    });
  });

  test("cancel and abandon come first", () => {
    expect(
      classifyExit({ ...base, cancelled: true, timedOut: true }).kind,
    ).toBe("cancelled");
    expect(
      classifyExit({ ...base, abandoned: true, cancelled: true }).kind,
    ).toBe("abandon");
  });

  test("a clean result is an exit for the runner to finish", () => {
    expect(classifyExit(base).kind).toBe("exited");
  });
});

describe("re-attach", () => {
  function state(overrides: Partial<RunState> = {}): RunState {
    return {
      run: claimedRun(),
      containerName: `agent-run-${claimedRun().runId}`,
      credsDir: join(root, "creds", "x"),
      startedAt: 0,
      deadline: Date.now() + 3_600_000,
      milestones: {},
      ...overrides,
    };
  }

  test("decisions", () => {
    const live = { cancelRequested: false, live: true };
    expect(decideReattach(live, state())).toBe("reattach");
    expect(decideReattach(null, state())).toBe("reattach");
    expect(
      decideReattach({ cancelRequested: false, live: false }, state()),
    ).toBe("remove");
    expect(decideReattach(live, null)).toBe("remove");
    expect(decideReattach(live, state({ completedAt: 1 }))).toBe("remove");
  });

  test("boot re-attaches live runs and removes the rest", async () => {
    const kept = claimedRun();
    const dropped = claimedRun({ runId: "6720f0a1b2c3d4e5f6a7b8ca" });
    await writeRunState(runPaths(root, kept).state, state());
    await writeRunState(runPaths(root, dropped).state, state({ run: dropped }));
    const removed: string[] = [];
    const adopted: string[] = [];
    const reattached = await recoverRuns({
      root,
      docker: {
        listRuns: async () => [
          {
            id: "1",
            name: `agent-run-${kept.runId}`,
            runId: kept.runId,
            state: "running",
          },
          {
            id: "2",
            name: `agent-run-${dropped.runId}`,
            runId: dropped.runId,
            state: "exited",
          },
          {
            id: "3",
            name: "agent-run-orphan",
            runId: "orphan",
            state: "running",
          },
        ],
        stop: async () => {},
        remove: async (name) => {
          removed.push(name);
        },
      },
      web: {
        heartbeat: async (runId) => ({
          cancelRequested: false,
          live: runId === kept.runId || runId === "orphan",
        }),
      },
      log: silentLogger,
      reattach: async () => {},
      adopt: (runId) => {
        adopted.push(runId);
      },
    });
    expect(reattached).toEqual([kept.runId]);
    expect(adopted).toEqual([kept.runId]);
    expect(removed).toEqual([`agent-run-${dropped.runId}`, "agent-run-orphan"]);
  });
});
