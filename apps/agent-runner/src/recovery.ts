import { join } from "node:path";
import type { RunnerHeartbeatResponse } from "@repo/schemas";
import type { Docker } from "./docker";
import type { Logger } from "./log";
import { decideReattach } from "./run";
import type { RunnerWebApi } from "./web-client";
import { type RunState, readRunState } from "./workspace";

export interface RecoveryDeps {
  root: string;
  docker: Pick<Docker, "listRuns" | "stop" | "remove">;
  web: Pick<RunnerWebApi, "heartbeat">;
  log: Logger;
  reattach: (state: RunState) => Promise<void>;
  adopt: (runId: string, supervision: Promise<void>) => void;
}

/**
 * Boot: every container labelled as a run is asked about. Web is the only
 * record of what is live, so one it no longer holds is stopped and removed,
 * and the rest are supervised again from the start of their logs.
 */
export async function recoverRuns(deps: RecoveryDeps): Promise<string[]> {
  const containers = await deps.docker.listRuns();
  const reattached: string[] = [];
  for (const container of containers) {
    const state = await readRunState(
      join(deps.root, "state", `${container.runId}.json`),
    );
    let heartbeat: RunnerHeartbeatResponse | null = null;
    try {
      heartbeat = await deps.web.heartbeat(container.runId);
    } catch (error) {
      deps.log.warn("heartbeat on recovery failed", {
        runId: container.runId,
        error: String(error),
      });
    }
    const decision = decideReattach(heartbeat, state);
    deps.log.info("recovered container", {
      runId: container.runId,
      state: container.state,
      decision,
    });
    if (decision === "remove" || !state) {
      await deps.docker.stop(container.name, 20).catch(() => {});
      await deps.docker.remove(container.name).catch(() => {});
      continue;
    }
    deps.adopt(container.runId, deps.reattach(state));
    reattached.push(container.runId);
  }
  return reattached;
}
