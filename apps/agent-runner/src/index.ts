import { decideAdmission, hostProbes, sampleAdmission } from "./admission";
import { configFromEnv } from "./config";
import { jsonLogger } from "./log";
import { RunnerLoop } from "./loop";
import { ServiceTokens } from "./oauth";
import { RUNNER_VERSION } from "./version";
import { WebClient } from "./web-client";

if (process.argv.includes("--version")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

const log = jsonLogger(process.env.AGENT_RUNNER_DEBUG === "1");
const config = configFromEnv();
const tokens = new ServiceTokens(config.oauth);
const web = new WebClient(config.web, tokens);
const probes = hostProbes(config);

const loop = new RunnerLoop({
  runnerId: config.runnerId,
  web,
  async admission(live) {
    const sample = await sampleAdmission(probes, live, false);
    return decideAdmission(sample, {
      maxConcurrent: 0,
      minMemAvailableBytes: config.minMemAvailableBytes,
      minFreeDiskBytes: config.minFreeDiskBytes,
    });
  },
  startRun: async (run) => {
    log.warn("no harness in this build; leaving run to its lease", {
      runId: run.runId,
    });
  },
  merge: async (command) => log.warn("merge not handled", { ...command }),
  watchPr: async (watch) => log.debug("pr watch not handled", { ...watch }),
  log,
});

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info("stopping; containers stay up for re-attach", { signal });
  void loop.stop().finally(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log.info("agent-runner started", {
  version: RUNNER_VERSION,
  runnerId: config.runnerId,
});
loop.start();
