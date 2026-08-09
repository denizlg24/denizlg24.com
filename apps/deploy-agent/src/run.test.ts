import { describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { BuildLog } from "./build-log";
import { deploymentRequest, fakeExec, withTempDir } from "./fixtures";
import { PortAllocator } from "./ports";
import {
  containerNameFor,
  healthUrl,
  loopbackOnlyRouteManager,
  type RouteManager,
  RunError,
  reapSuperseded,
  renderEnvFile,
  resolveContainerPort,
  runDeployment,
  teardownDeployment,
} from "./run";

function recordingRoutes(): RouteManager & { published: string[] } {
  const published: string[] = [];
  return {
    published,
    publish: async (route) => {
      published.push(`${route.hostname}=${route.port}`);
    },
    withdraw: async () => {},
  };
}

const noSleep = async (): Promise<void> => {};

describe("renderEnvFile", () => {
  it("writes plain KEY=VALUE lines", () => {
    expect(renderEnvFile({ A: "1", B: "two words" })).toBe(
      "A=1\nB=two words\n",
    );
  });

  it("refuses a value docker --env-file cannot represent", () => {
    expect(() => renderEnvFile({ KEY: "line\nline" })).toThrow(RunError);
  });

  it("refuses a key that is not an identifier", () => {
    expect(() => renderEnvFile({ "not-a-key": "x" })).toThrow(RunError);
  });
});

describe("healthUrl", () => {
  it("targets loopback and tolerates a path without a slash", () => {
    expect(healthUrl(24_817, "/healthz")).toBe(
      "http://127.0.0.1:24817/healthz",
    );
    expect(healthUrl(24_817, "healthz")).toBe("http://127.0.0.1:24817/healthz");
  });
});

describe("resolveContainerPort", () => {
  const base = {
    log: new BuildLog(
      { path: join(".", "unused.log") },
      {
        write: () => {},
        end: async () => {},
      },
    ),
    imageTag: "forge/app:1",
    signal: new AbortController().signal,
  };

  it("prefers an explicitly pinned port", async () => {
    const exec = fakeExec();
    expect(
      await resolveContainerPort({
        ...base,
        builder: "dockerfile",
        exec: exec.exec,
        request: deploymentRequest({ runtime: { containerPort: 8080 } }),
      }),
    ).toBe(8080);
    expect(exec.calls).toHaveLength(0);
  });

  it("takes the lowest exposed TCP port", async () => {
    const exec = fakeExec(() => ({
      stdout: '{"9000/tcp":{},"8080/tcp":{},"53/udp":{}}',
    }));
    expect(
      await resolveContainerPort({
        ...base,
        builder: "dockerfile",
        exec: exec.exec,
        request: deploymentRequest(),
      }),
    ).toBe(8080);
  });

  it("falls back to 3000 when the image exposes nothing", async () => {
    const exec = fakeExec(() => ({ stdout: "null" }));
    expect(
      await resolveContainerPort({
        ...base,
        builder: "dockerfile",
        exec: exec.exec,
        request: deploymentRequest(),
      }),
    ).toBe(3_000);
  });

  it("does not inspect a nixpacks image, which is built with PORT set", async () => {
    const exec = fakeExec();
    expect(
      await resolveContainerPort({
        ...base,
        builder: "nixpacks",
        exec: exec.exec,
        request: deploymentRequest(),
      }),
    ).toBe(3_000);
    expect(exec.calls).toHaveLength(0);
  });
});

describe("runDeployment", () => {
  function deploy(
    dir: string,
    options: {
      healthStatuses?: (number | null)[];
      overrides?: Parameters<typeof deploymentRequest>[0];
    } = {},
  ) {
    const statuses = [...(options.healthStatuses ?? [200])];
    const request = deploymentRequest(options.overrides);
    const exec = fakeExec((call) => {
      if (call.command.includes("run")) return { stdout: "container-abc\n" };
      if (call.command.some((part) => part.includes("{{.State.Running}}"))) {
        return { stdout: "true false 0\n" };
      }
      return undefined;
    });
    const log = new BuildLog({ path: join(dir, "run.log") });
    const routes = recordingRoutes();
    const phases: string[] = [];
    let clock = 0;

    const promise = runDeployment({
      request,
      builder: "dockerfile",
      imageTag: "forge/app:1",
      port: 24_817,
      log,
      signal: new AbortController().signal,
      exec: exec.exec,
      routes,
      envRoot: join(dir, "env"),
      network: "forge-apps",
      env: { DATABASE_URL: "postgres://x" },
      healthProbe: async () => statuses.shift() ?? null,
      healthPollMs: 1,
      sleep: async () => {
        clock += 2_000;
      },
      now: () => clock,
      onPhase: async (phase) => {
        phases.push(phase);
      },
    });
    return {
      promise,
      request,
      exec,
      log,
      routes,
      phases,
      envRoot: join(dir, "env"),
    };
  }

  it("starts, gates and routes", async () => {
    await withTempDir(async (dir) => {
      const { promise, exec, routes, phases, request } = deploy(dir);
      const outcome = await promise;

      expect(outcome.containerId).toBe("container-abc");
      expect(phases).toEqual(["starting", "health-check", "routing"]);
      expect(routes.published).toEqual([`${request.hostname}=24817`]);

      const run = exec.find("docker run")?.command ?? [];
      expect(run).toContain("--publish");
      expect(run).toContain("127.0.0.1:24817:3000");
      expect(run).toContain(`forge.deployment=${request.deploymentId}`);
      expect(run).toContain(`forge.target=${request.targetId}`);
      expect(run).toContain("no-new-privileges");
      expect(
        run.slice(run.indexOf("--memory"), run.indexOf("--memory") + 2),
      ).toEqual(["--memory", `${request.runtime.memoryLimitMb}m`]);
      expect(
        run.slice(
          run.indexOf("--memory-reservation"),
          run.indexOf("--memory-reservation") + 2,
        ),
      ).toEqual([
        "--memory-reservation",
        `${request.runtime.memoryReservationMb}m`,
      ]);
      expect(run).toContain("--oom-score-adj");
    });
  });

  it("deletes the env file once the container is created", async () => {
    await withTempDir(async (dir) => {
      const { promise, envRoot } = deploy(dir);
      await promise;
      expect(await readdir(envRoot)).toEqual([]);
    });
  });

  it("accepts any status under 500", async () => {
    await withTempDir(async (dir) => {
      const { promise, routes } = deploy(dir, { healthStatuses: [404] });
      await promise;
      expect(routes.published).toHaveLength(1);
    });
  });

  it("keeps polling past a 5xx", async () => {
    await withTempDir(async (dir) => {
      const { promise, routes } = deploy(dir, {
        healthStatuses: [null, 503, 200],
      });
      await promise;
      expect(routes.published).toHaveLength(1);
    });
  });

  it("removes the new container and publishes no route when the gate fails", async () => {
    await withTempDir(async (dir) => {
      const { promise, exec, routes, request } = deploy(dir, {
        healthStatuses: [],
      });
      await expect(promise).rejects.toThrow(/Health check/);
      expect(routes.published).toEqual([]);
      const name = containerNameFor(request.deploymentId);
      const removals = exec.calls.filter((call) =>
        call.command.join(" ").includes(`rm --force ${name}`),
      );
      // One before the run to clear a stale name, one to clean up the failure.
      expect(removals).toHaveLength(2);
      expect(exec.find("docker logs")?.command).toContain("--tail");
    });
  });

  it("gives up early when the container exits", async () => {
    await withTempDir(async (dir) => {
      const request = deploymentRequest();
      const exec = fakeExec((call) => {
        if (call.command.includes("run")) return { stdout: "container-abc\n" };
        if (call.command.some((part) => part.includes("{{.State.Running}}"))) {
          return { stdout: "false false 1\n" };
        }
        return undefined;
      });
      const log = new BuildLog({ path: join(dir, "run.log") });

      await expect(
        runDeployment({
          request,
          builder: "dockerfile",
          imageTag: "forge/app:1",
          port: 24_817,
          log,
          signal: new AbortController().signal,
          exec: exec.exec,
          routes: loopbackOnlyRouteManager(),
          envRoot: join(dir, "env"),
          network: "forge-apps",
          healthProbe: async () => null,
          healthPollMs: 1,
          sleep: noSleep,
        }),
      ).rejects.toThrow(/exited before it became healthy/);
    });
  });

  it("names the memory ceiling when the cgroup killed the container", async () => {
    await withTempDir(async (dir) => {
      // An OOM kill is a SIGKILL and exit 137, indistinguishable from any other
      // hard stop unless State.OOMKilled is read — and the application logs are
      // empty, because the process was never told anything.
      const request = deploymentRequest();
      const exec = fakeExec((call) => {
        if (call.command.includes("run")) return { stdout: "container-abc\n" };
        if (call.command.some((part) => part.includes("{{.State.Running}}"))) {
          return { stdout: "false true 137\n" };
        }
        return undefined;
      });
      const log = new BuildLog({ path: join(dir, "run.log") });

      await expect(
        runDeployment({
          request,
          builder: "dockerfile",
          imageTag: "forge/app:1",
          port: 24_817,
          log,
          signal: new AbortController().signal,
          exec: exec.exec,
          routes: loopbackOnlyRouteManager(),
          envRoot: join(dir, "env"),
          network: "forge-apps",
          healthProbe: async () => null,
          healthPollMs: 1,
          sleep: noSleep,
        }),
      ).rejects.toThrow(/memory ceiling/);
    });
  });

  it("passes startCommand as a run-time override only on the dockerfile path", async () => {
    await withTempDir(async (dir) => {
      const { promise, exec } = deploy(dir, {
        overrides: { build: { startCommand: "bun start" } },
      });
      await promise;
      expect(exec.find("docker run")?.command).toContain("bun start");
    });
  });
});

describe("teardownDeployment", () => {
  function withdrawer(): RouteManager & { withdrawn: string[] } {
    const withdrawn: string[] = [];
    return {
      withdrawn,
      publish: async () => {},
      withdraw: async (deploymentId) => {
        withdrawn.push(deploymentId);
      },
    };
  }

  it("drops the route before removing the container", async () => {
    const order: string[] = [];
    const routes = withdrawer();
    const exec = fakeExec((call) => {
      order.push(call.command.slice(0, 2).join(" "));
      if (call.command.includes("{{.Config.Image}}")) {
        return { stdout: "forge/app:abc1234-dep\n" };
      }
      return undefined;
    });
    const ports = new PortAllocator({ probe: async () => false });
    ports.reserve(24_817, "dep-1");

    const result = await teardownDeployment({
      deploymentId: "dep-1",
      exec: exec.exec,
      routes: {
        publish: routes.publish,
        withdraw: async (id) => {
          order.push("withdraw");
          await routes.withdraw(id);
        },
      },
      ports,
    });

    expect(order[0]).toBe("withdraw");
    expect(routes.withdrawn).toEqual(["dep-1"]);
    expect(result).toEqual({
      containerRemoved: true,
      imageRemoved: "forge/app:abc1234-dep",
    });
    expect(ports.reservations().size).toBe(0);
  });

  it("never deletes the moving tag that holds the build cache", async () => {
    const exec = fakeExec((call) =>
      call.command.includes("{{.Config.Image}}")
        ? { stdout: "forge/app:latest\n" }
        : undefined,
    );
    const result = await teardownDeployment({
      deploymentId: "dep-1",
      exec: exec.exec,
      routes: withdrawer(),
    });
    expect(result.imageRemoved).toBeNull();
    expect(
      exec.commands.some((command) => command.startsWith("docker rmi")),
    ).toBe(false);
  });

  it("succeeds on a deployment that never had a container", async () => {
    const exec = fakeExec(() => ({ exitCode: 1, stderr: "No such object" }));
    const result = await teardownDeployment({
      deploymentId: "dep-1",
      exec: exec.exec,
      routes: withdrawer(),
    });
    expect(result).toEqual({ containerRemoved: false, imageRemoved: null });
  });

  it("tolerates an image another container still uses", async () => {
    const exec = fakeExec((call) => {
      if (call.command.includes("{{.Config.Image}}")) {
        return { stdout: "forge/app:abc1234-dep\n" };
      }
      if (call.command[1] === "rmi") {
        return {
          exitCode: 1,
          stderr: "image is being used by running container",
        };
      }
      return undefined;
    });
    const result = await teardownDeployment({
      deploymentId: "dep-1",
      exec: exec.exec,
      routes: withdrawer(),
    });
    expect(result).toEqual({ containerRemoved: true, imageRemoved: null });
  });
});

describe("reapSuperseded", () => {
  function log(): BuildLog {
    return new BuildLog(
      { path: "unused" },
      { write: () => {}, end: async () => {} },
    );
  }

  it("stops every superseded production container but the new one", async () => {
    const exec = fakeExec((call) =>
      call.command.includes("ps")
        ? { stdout: "cid-old\tdep-old\ncid-new\tdep-new\n" }
        : undefined,
    );
    const reaped = await reapSuperseded({
      exec: exec.exec,
      log: log(),
      targetId: "target-1",
      kind: "production",
      keepDeploymentId: "dep-new",
      drainMs: 10_000,
      sleep: noSleep,
    });

    expect(reaped).toEqual([
      { containerId: "cid-old", deploymentId: "dep-old" },
    ]);
    expect(exec.find("docker stop")?.command).toContain("cid-old");
    expect(exec.commands.some((command) => command.includes("cid-new"))).toBe(
      false,
    );
  });

  it("leaves previews alone", async () => {
    const exec = fakeExec(() => ({ stdout: "cid-old\tdep-old\n" }));
    expect(
      await reapSuperseded({
        exec: exec.exec,
        log: log(),
        targetId: "target-1",
        kind: "preview",
        keepDeploymentId: "dep-new",
        drainMs: 0,
        sleep: noSleep,
      }),
    ).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  it("drains before stopping anything", async () => {
    const order: string[] = [];
    const exec = fakeExec((call) => {
      order.push(call.command[1] ?? "");
      return call.command.includes("ps")
        ? { stdout: "cid-old\tdep-old\n" }
        : undefined;
    });
    await reapSuperseded({
      exec: exec.exec,
      log: log(),
      targetId: "target-1",
      kind: "production",
      keepDeploymentId: "dep-new",
      drainMs: 10_000,
      sleep: async () => {
        order.push("drain");
      },
    });
    expect(order).toEqual(["ps", "drain", "stop", "rm"]);
  });

  it("leaves the old container running when it cannot list", async () => {
    const exec = fakeExec(() => ({ exitCode: 1, stderr: "daemon down" }));
    expect(
      await reapSuperseded({
        exec: exec.exec,
        log: log(),
        targetId: "target-1",
        kind: "production",
        keepDeploymentId: "dep-new",
        drainMs: 0,
        sleep: noSleep,
      }),
    ).toEqual([]);
  });
});
