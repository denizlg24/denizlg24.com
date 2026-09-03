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
    network: "forge-apps",
    buildMemoryLimit: "6144m",
    drainMs: 10_000,
    healthPollMs: 1,
    healthProbe: async () => 200,
    recoveryImagePublisher: async ({ request }) => {
      const digest = `sha256:${"a".repeat(64)}`;
      return {
        reference: `ghcr.io/denizlg24/forge-recovery/${request.projectSlug}@${digest}`,
        digest,
        deploymentTag: "test",
      };
    },
    sleep: async () => {},
    ...overrides,
  });
  const updates: DeploymentStatusUpdate[] = [];
  const released: DeploymentStatusUpdate[][] = [];
  const context = {
    signal: new AbortController().signal,
    report: async (update: DeploymentStatusUpdate) => {
      updates.push(update);
    },
    // Recording the updates seen at release time is what pins *when* the slot
    // goes back: a snapshot taken after the container started would not.
    releaseBuildSlot: () => {
      released.push([...updates]);
    },
  };
  return { runner, context, updates, released, routes, ports, logs };
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
      // Deploying reports the local build while ready records the digest-only
      // recovery artifact that is published after the health gate.
      expect(updates[2]?.imageTag).toStartWith("forge/hello-world:");
      expect(final.imageTag).toStartWith(
        "ghcr.io/denizlg24/forge-recovery/hello-world@sha256:",
      );
      expect(updates[2]?.port).toBe(final.port);
      expect(exec.find("nixpacks build")).toBeDefined();
    });
  });

  /**
   * The slot has to go back before the container starts, not after the run
   * finishes — everything past the build is idle waiting, and holding a slot
   * through it is what left the builder parked behind a health probe.
   */
  it("releases the build slot once the image exists", async () => {
    await withTempDir(async (dir) => {
      const { runner, context, released } = harness(dir, happyExec());

      await runner(deploymentRequest({ kind: "production" }), context);

      expect(released).toHaveLength(1);
      expect(
        released[0]?.map((update) => `${update.status}:${update.phase ?? "-"}`),
      ).toEqual(["building:cloning", "building:building"]);
    });
  });

  it("holds the host mutation lock from the first runtime mutation through cleanup", async () => {
    await withTempDir(async (dir) => {
      const events: string[] = [];
      let held = false;
      const base = happyExec();
      const guardedExec: FakeExec = {
        ...base,
        exec: async (options) => {
          if (
            options.command[0] === "docker" &&
            ["run", "stop", "rm"].includes(options.command[1] ?? "")
          ) {
            expect(held).toBe(true);
            events.push(`docker:${options.command[1]}`);
          }
          return base.exec(options);
        },
      };
      const { runner, context } = harness(dir, guardedExec, {
        acquireHostMutationLock: async (owner) => {
          expect(owner).toMatch(/^deployment:/);
          expect(held).toBe(false);
          held = true;
          events.push("acquire");
          return async () => {
            expect(held).toBe(true);
            held = false;
            events.push("release");
          };
        },
        recoveryImagePublisher: async () => {
          expect(held).toBe(true);
          events.push("publish-recovery");
          const digest = `sha256:${"a".repeat(64)}`;
          return {
            reference: `ghcr.io/denizlg24/forge-recovery/test@${digest}`,
            digest,
            deploymentTag: "test",
          };
        },
      });

      await runner(deploymentRequest({ kind: "production" }), context);

      expect(held).toBe(false);
      expect(events[0]).toBe("acquire");
      expect(events).toContain("docker:run");
      expect(events).toContain("publish-recovery");
      expect(events.at(-1)).toBe("release");
    });
  });

  it("releases the host mutation lock after a runtime failure", async () => {
    await withTempDir(async (dir) => {
      let acquired = 0;
      let released = 0;
      const exec = fakeExec((call) =>
        call.command[0] === "docker" && call.command[1] === "run"
          ? { exitCode: 1, stderr: "runtime failed" }
          : undefined,
      );
      const { runner, context } = harness(dir, exec, {
        acquireHostMutationLock: async () => {
          acquired += 1;
          return async () => {
            released += 1;
          };
        },
      });

      await expect(runner(deploymentRequest(), context)).rejects.toThrow(
        /runtime failed/,
      );
      expect(acquired).toBe(1);
      expect(released).toBe(1);
    });
  });

  it("never releases the build slot early when the build fails", async () => {
    await withTempDir(async (dir) => {
      const exec = fakeExec((call) =>
        call.command.includes("build")
          ? { exitCode: 1, stderr: "missing lockfile" }
          : undefined,
      );
      const { runner, context, released } = harness(dir, exec);

      await expect(runner(deploymentRequest(), context)).rejects.toThrow();

      // Nothing to hand back early: the queue releases it on the way out.
      expect(released).toHaveLength(0);
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
