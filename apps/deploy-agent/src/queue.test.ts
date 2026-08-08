import { describe, expect, it } from "bun:test";
import type {
  AgentDeploymentRequest,
  DeploymentStatusUpdate,
} from "@repo/schemas/cloud";

import { deploymentRequest } from "./fixtures";
import {
  DeploymentQueue,
  type DeploymentQueueOptions,
  type DeploymentRunner,
  QueueAtCapacityError,
} from "./queue";

interface Harness {
  queue: DeploymentQueue;
  reports: Array<{ deploymentId: string; update: DeploymentStatusUpdate }>;
  errors: string[];
  infos: string[];
}

function harness(
  overrides: Partial<DeploymentQueueOptions> = {},
  queued: AgentDeploymentRequest[] = [],
): Harness {
  const reports: Harness["reports"] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const pending = [...queued];
  const queue = new DeploymentQueue({
    capacity: 1,
    pollIntervalMs: 5,
    heartbeatIntervalMs: 10_000,
    claim: async () => pending.shift() ?? null,
    report: async (deploymentId, update) => {
      reports.push({ deploymentId, update });
    },
    runner: async () => ({ status: "ready" }),
    logger: {
      info: (message) => infos.push(message),
      error: (message) => errors.push(message),
    },
    ...overrides,
  });
  return { queue, reports, errors, infos };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** Runs until cancelled, and honours the abort — what a real runner must do. */
const abortableRunner: DeploymentRunner = (_request, context) =>
  new Promise((_resolve, reject) => {
    context.signal.addEventListener("abort", () =>
      reject(new Error("aborted")),
    );
  });

/** Ignores its abort signal. Only used to prove stop() stays bounded anyway. */
const wedgedRunner: DeploymentRunner = () => new Promise(() => {});

describe("DeploymentQueue.pump", () => {
  it("claims up to capacity and no further", async () => {
    let claims = 0;
    const requests = [
      deploymentRequest(),
      deploymentRequest(),
      deploymentRequest(),
    ];
    const { queue } = harness({
      capacity: 2,
      claim: async () => {
        claims += 1;
        return requests.shift() ?? null;
      },
      runner: () => new Promise(() => {}),
    });

    await queue.pump();

    expect(queue.runningCount).toBe(2);
    expect(claims).toBe(2);
  });

  it("stops claiming when the control plane has nothing queued", async () => {
    let claims = 0;
    const { queue } = harness({
      capacity: 3,
      claim: async () => {
        claims += 1;
        return null;
      },
    });

    await queue.pump();

    expect(claims).toBe(1);
    expect(queue.runningCount).toBe(0);
  });

  it("frees the slot and reports the runner's final status", async () => {
    const request = deploymentRequest();
    const { queue, reports } = harness(
      { runner: async () => ({ status: "ready", port: 24_817 }) },
      [request],
    );

    await queue.pump();
    await settle();

    expect(queue.runningCount).toBe(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.deploymentId).toBe(request.deploymentId);
    expect(reports[0]?.update.status).toBe("ready");
    expect(queue.get(request.deploymentId)?.port).toBe(24_817);
  });

  it("reports failure when the runner throws, and keeps accepting work", async () => {
    const request = deploymentRequest();
    const { queue, reports } = harness(
      {
        runner: async () => {
          throw new Error("nixpacks exited 1");
        },
      },
      [request],
    );

    await queue.pump();
    await settle();

    expect(reports[0]?.update.status).toBe("failed");
    expect(reports[0]?.update.error).toBe("nixpacks exited 1");
    expect(queue.runningCount).toBe(0);
  });

  it("surfaces intermediate progress through the runner's report callback", async () => {
    const request = deploymentRequest();
    const runner: DeploymentRunner = async (_request, context) => {
      await context.report({ status: "building", phase: "cloning" });
      await context.report({ status: "building", phase: "building" });
      return { status: "ready" };
    };
    const { queue, reports } = harness({ runner }, [request]);

    await queue.pump();
    await settle();

    expect(reports.map((entry) => entry.update.phase)).toEqual([
      "cloning",
      "building",
      undefined,
    ]);
  });

  it("does not fail a build when a progress report fails", async () => {
    const request = deploymentRequest();
    let calls = 0;
    const runner: DeploymentRunner = async (_request, context) => {
      await context.report({ status: "building", phase: "cloning" });
      return { status: "ready" };
    };
    const { queue, errors } = harness(
      {
        runner,
        report: async () => {
          calls += 1;
          if (calls === 1) throw new Error("control plane 502");
        },
      },
      [request],
    );

    await queue.pump();
    await settle();

    expect(queue.get(request.deploymentId)?.status).toBe("ready");
    expect(errors).toContain("progress report failed");
  });
});

describe("DeploymentQueue.cancel", () => {
  it("aborts a running deployment and reports it cancelled", async () => {
    const request = deploymentRequest();
    const runner: DeploymentRunner = (_request, context) =>
      new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const { queue, reports } = harness({ runner }, [request]);

    await queue.pump();
    expect(queue.cancel(request.deploymentId)).toBe(true);
    await settle();

    expect(reports[0]?.update.status).toBe("cancelled");
    expect(queue.runningCount).toBe(0);
  });

  it("returns false for a deployment that is not running", () => {
    const { queue } = harness();
    expect(queue.cancel(crypto.randomUUID())).toBe(false);
  });
});

describe("DeploymentQueue.submit", () => {
  it("refuses at capacity rather than queueing locally", async () => {
    const { queue } = harness({ runner: () => new Promise(() => {}) });

    queue.submit(deploymentRequest());

    expect(() => queue.submit(deploymentRequest())).toThrow(
      QueueAtCapacityError,
    );
  });

  it("is idempotent for a deployment already running", () => {
    const request = deploymentRequest();
    const { queue } = harness({ runner: () => new Promise(() => {}) });

    const first = queue.submit(request);
    const second = queue.submit(request);

    expect(second.deploymentId).toBe(first.deploymentId);
    expect(queue.runningCount).toBe(1);
  });
});

describe("DeploymentQueue history", () => {
  it("answers lookups after a deployment finishes", async () => {
    const request = deploymentRequest();
    const { queue } = harness({}, [request]);

    await queue.pump();
    await settle();

    expect(queue.get(request.deploymentId)?.status).toBe("ready");
  });

  it("bounds retained history", async () => {
    const requests = Array.from({ length: 5 }, () => deploymentRequest());
    const { queue } = harness({ historyLimit: 2 }, requests);

    for (let i = 0; i < requests.length; i += 1) {
      await queue.pump();
      await settle();
    }

    expect(queue.list()).toHaveLength(2);
    expect(queue.get(requests[0]!.deploymentId)).toBeNull();
    expect(queue.get(requests[4]!.deploymentId)?.status).toBe("ready");
  });
});

describe("DeploymentQueue.start", () => {
  it("survives a claim that throws and keeps polling", async () => {
    const request = deploymentRequest();
    let claims = 0;
    const { queue, errors, infos } = harness({
      claim: async () => {
        claims += 1;
        if (claims === 1) throw new Error("tunnel down");
        return claims === 2 ? request : null;
      },
    });

    queue.start();
    await settle();
    await queue.stop();

    // One blip is reported, but not as an error: the control plane restarting
    // is ordinary, and an error here is what teaches the reader to skim.
    expect(infos).toContain("claim failed");
    expect(errors).not.toContain("claim failed");
    expect(infos).toContain("control plane reachable");
    expect(queue.get(request.deploymentId)?.status).toBe("ready");
  });

  it("escalates to error once the control plane stays unreachable", async () => {
    const { queue, errors } = harness({
      claim: async () => {
        throw new Error("connection refused");
      },
    });

    queue.start();
    await settle();
    await queue.stop();

    expect(errors).toContain("claim failed");
  });

  it("heartbeats running deployments", async () => {
    const request = deploymentRequest();
    const { queue, reports } = harness(
      { heartbeatIntervalMs: 5, runner: abortableRunner },
      [request],
    );

    queue.start();
    await settle();
    await queue.stop();

    const heartbeats = reports.filter(
      (entry) => entry.update.status === "building",
    );
    expect(heartbeats.length).toBeGreaterThan(0);
  });

  it("aborts in-flight work on stop", async () => {
    const request = deploymentRequest();
    const { queue } = harness({ runner: abortableRunner }, [request]);

    queue.start();
    await settle();
    await queue.stop();

    expect(queue.runningCount).toBe(0);
    expect(queue.get(request.deploymentId)?.status).toBe("cancelled");
  });

  it("stops within the grace period even if a runner ignores its abort", async () => {
    const request = deploymentRequest();
    const { queue, errors } = harness(
      { runner: wedgedRunner, stopGraceMs: 50 },
      [request],
    );

    queue.start();
    await settle();
    const startedAt = Date.now();
    await queue.stop();

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(errors).toContain("stopped with deployments still in flight");
  });
});
