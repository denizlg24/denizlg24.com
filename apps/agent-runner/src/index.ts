import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { decideAdmission, hostProbes, sampleAdmission } from "./admission";
import { handleMerge, PrWatcher } from "./commands";
import { assertRuntimeSupported, configFromEnv } from "./config";
import { Docker } from "./docker";
import { runCommand } from "./exec";
import { GitHubClient, RunTokenSource } from "./github";
import { ClaudeCodeHarness } from "./harness/claude-code";
import { jsonLogger } from "./log";
import { RunnerLoop } from "./loop";
import { applyEgressRules } from "./network";
import { ServiceTokens } from "./oauth";
import { recoverRuns } from "./recovery";
import { RunSupervisor } from "./run";
import { RUNNER_VERSION } from "./version";
import { WebClient } from "./web-client";
import { mappedUid, Workspaces } from "./workspace";

const EGRESS_CHECK_MS = 5 * 60_000;
const GC_INTERVAL_MS = 60 * 60_000;

if (process.argv.includes("--version")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

const log = jsonLogger(process.env.AGENT_RUNNER_DEBUG === "1");

async function main(): Promise<void> {
  const config = configFromEnv();
  const docker = new Docker();
  assertRuntimeSupported(config.containerRuntime, await docker.runtimes());

  const user = userInfo().username;
  const hostUid = mappedUid(await readFile("/etc/subuid", "utf8"), user);
  if (hostUid === null) {
    throw new Error(`/etc/subuid has no range for ${user}`);
  }

  const tokens = new ServiceTokens(config.oauth);
  const web = new WebClient(config.web, tokens);
  const runTokens = new RunTokenSource(config.api, tokens);
  const github = (token: () => string) => new GitHubClient(token);
  const workspaces = new Workspaces(config, docker, runCommand, hostUid, log);
  await workspaces.bootstrap();

  let egressReady = false;
  const checkEgress = async () => {
    try {
      await applyEgressRules(docker, config);
      if (!egressReady) log.info("egress rules verified");
      egressReady = true;
    } catch (error) {
      egressReady = false;
      log.error("egress rules missing; not scheduling runs", {
        error: String(error),
      });
    }
  };
  await checkEgress();

  let loop: RunnerLoop | null = null;
  const supervisor = new RunSupervisor({
    config,
    runnerVersion: RUNNER_VERSION,
    web,
    docker,
    workspaces,
    runTokens,
    github,
    harness: new ClaudeCodeHarness(config.credentials),
    log,
    onFinished: () => {
      void workspaces
        .gc(new Set(loop?.liveRunIds() ?? []))
        .catch((error: unknown) =>
          log.warn("workspace gc failed", { error: String(error) }),
        );
    },
  });
  const watcher = new PrWatcher({ web, runTokens, github });
  const probes = hostProbes(config);

  loop = new RunnerLoop({
    runnerId: config.runnerId,
    web,
    async admission(live) {
      const sample = await sampleAdmission(probes, live, egressReady);
      return decideAdmission(sample, config);
    },
    startRun: (run) => supervisor.start(run),
    merge: (command) => handleMerge(command, { web, runTokens, github }),
    watchPr: (watch) => watcher.watch(watch),
    log,
  });

  const activeLoop = loop;
  const recovered = await recoverRuns({
    root: config.root,
    docker,
    web,
    log,
    reattach: (state) => supervisor.reattach(state),
    adopt: (runId, supervision) => activeLoop.adopt(runId, supervision),
  });

  const egressTimer = setInterval(() => void checkEgress(), EGRESS_CHECK_MS);
  const gcTimer = setInterval(() => {
    void workspaces
      .gc(new Set(activeLoop.liveRunIds()))
      .catch((error: unknown) =>
        log.warn("workspace gc failed", { error: String(error) }),
      );
  }, GC_INTERVAL_MS);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(egressTimer);
    clearInterval(gcTimer);
    log.info("stopping; containers stay up for re-attach", {
      signal,
      live: activeLoop.liveRunIds(),
    });
    void activeLoop.stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  log.info("agent-runner started", {
    version: RUNNER_VERSION,
    runnerId: config.runnerId,
    runtime: config.containerRuntime,
    recovered,
  });
  activeLoop.start();
}

main().catch((error: unknown) => {
  log.error("agent-runner failed to start", { error: String(error) });
  process.exit(1);
});
