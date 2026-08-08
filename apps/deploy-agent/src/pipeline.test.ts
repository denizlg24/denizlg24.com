import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { DeploymentStatusUpdate } from "@repo/schemas/cloud";

import { BuildLogStore } from "./build-log";
import {
  deploymentRequest,
  type FakeExec,
  fakeExec,
  withTempDir,
} from "./fixtures";
import { createDeploymentRunner, type PipelineOptions } from "./pipeline";
import { PortAllocator } from "./ports";
import type { RouteManager } from "./run";

function routeRecorder(): RouteManager & { published: number[] } {
  const published: number[] = [];
  return {
    published,
    publish: async (route) => {
      published.push(route.port);
    },
    withdraw: async () => {},
  };
}

function harness(
  dir: string,
  exec: FakeExec,
  overrides: Partial<PipelineOptions> = {},
) {
  const routes = routeRecorder();
  const ports = new PortAllocator({ probe: async () => false });
  const logs = new BuildLogStore({ root: join(dir, "logs") });
  const runner = createDeploymentRunner({
    exec: exec.exec,
    logs,
    ports,
    routes,
    buildRoot: join(dir, "builds"),
    envRoot: join(dir, "env"),
    network: "forge-apps",
    buildMemoryLimit: "6144m",
    drainMs: 10_000,
    healthPollMs: 1,
    healthProbe: async () => 200,
    sleep: async () => {},
    ...overrides,
  });
  const updates: DeploymentStatusUpdate[] = [];
  const context = {
    signal: new AbortController().signal,
    report: async (update: DeploymentStatusUpdate) => {
      updates.push(update);
    },
  };
  return { runner, context, updates, routes, ports, logs };
}

function happyExec(): FakeExec {
  return fakeExec((call) => {
    if (call.command[0] === "docker" && call.command[1] === "run") {
      return { stdout: "container-abc\n" };
    }
    if (call.command.includes("{{.State.Running}}"))
      return { stdout: "true\n" };
    if (call.command.includes("{{.Size}}")) return { stdout: "4096\n" };
    if (call.command.includes("ps")) return { stdout: "" };
    return undefined;
  });
}

describe("createDeploymentRunner", () => {
  it("runs clone → build → run → health → route and reports ready", async () => {
    await withTempDir(async (dir) => {
      const exec = happyExec();
      const { runner, context, updates, routes } = harness(dir, exec);
      const request = deploymentRequest({ kind: "production" });

      const final = await runner(request, context);

      expect(
        updates.map((update) => `${update.status}:${update.phase ?? "-"}`),
      ).toEqual([
        "building:cloning",
        "building:building",
        "deploying:starting",
        "deploying:health-check",
        "deploying:routing",
        "ready:-",
      ]);
      expect(final.status).toBe("ready");
      expect(final.containerId).toBe("container-abc");
      expect(final.imageSizeBytes).toBe(4096);
      expect(final.port).toBe(routes.published[0]);
      // The image tag and the port are known before the run and reported with
      // it, not held back until ready.
      expect(updates[2]?.imageTag).toBe(final.imageTag);
      expect(updates[2]?.port).toBe(final.port);
      expect(exec.find("nixpacks build")).toBeDefined();
    });
  });

  it("holds the port for a ready deployment and frees it on failure", async () => {
    await withTempDir(async (dir) => {
      const good = happyExec();
      const first = harness(dir, good);
      await first.runner(deploymentRequest(), first.context);
      expect(first.ports.reservations().size).toBe(1);

      const bad = fakeExec((call) =>
        call.command.includes("build")
          ? { exitCode: 1, stderr: "nixpacks exploded" }
          : undefined,
      );
      const second = harness(dir, bad);
      await expect(
        second.runner(deploymentRequest(), second.context),
      ).rejects.toThrow(/nixpacks exploded/);
      expect(second.ports.reservations().size).toBe(0);
    });
  });

  it("reaps the superseded production container after reporting ready", async () => {
    await withTempDir(async (dir) => {
      const exec = fakeExec((call) => {
        if (call.command[0] === "docker" && call.command[1] === "run") {
          return { stdout: "container-new\n" };
        }
        if (call.command.includes("{{.State.Running}}"))
          return { stdout: "true\n" };
        if (call.command.includes("ps")) {
          return { stdout: "container-old\tdeployment-old\n" };
        }
        return undefined;
      });
      const { runner, context, updates } = harness(dir, exec);

      await runner(deploymentRequest({ kind: "production" }), context);

      expect(updates.at(-1)?.status).toBe("ready");
      expect(exec.find("docker stop")?.command).toContain("container-old");
      // The list happens after the ready report, never before it.
      const psIndex = exec.commands.findIndex((command) =>
        command.startsWith("docker ps"),
      );
      expect(psIndex).toBeGreaterThan(-1);
    });
  });

  it("leaves a readable log behind for a failed build", async () => {
    await withTempDir(async (dir) => {
      const exec = fakeExec((call) =>
        call.command.includes("build")
          ? { exitCode: 1, stderr: "missing lockfile" }
          : undefined,
      );
      const { runner, context, logs } = harness(dir, exec);
      const request = deploymentRequest();

      await expect(runner(request, context)).rejects.toThrow();

      const lines: string[] = [];
      for await (const line of logs.stream(request.deploymentId))
        lines.push(line);
      expect(lines.join("\n")).toContain("deployment failed");
      expect(lines.join("\n")).toContain("missing lockfile");
    });
  });
});
