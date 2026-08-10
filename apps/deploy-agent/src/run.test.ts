import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { BuildLog } from "./build-log";
import {
  deploymentRequest,
  type ExecResponder,
  fakeExec,
  withTempDir,
} from "./fixtures";
import { PortAllocator } from "./ports";
import {
  applyDeploymentEnv,
  containerNameFor,
  healthUrl,
  loopbackOnlyRouteManager,
  type RouteManager,
  RunError,
  reapSuperseded,
  renderEnvArgs,
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

describe("renderEnvArgs", () => {
  it("emits one --env flag per variable", () => {
    expect(renderEnvArgs({ A: "1", B: "two words" })).toEqual([
      "--env",
      "A=1",
      "--env",
      "B=two words",
    ]);
  });

  // Every one of these either failed the deployment outright or arrived at the
  // container altered, back when this rendered a `docker --env-file`.
  it("carries values argv cannot misread", () => {
    const pem = "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----\n";
    expect(renderEnvArgs({ PEM: pem })).toEqual(["--env", `PEM=${pem}`]);
    expect(
      renderEnvArgs({
        QUOTED: '"quoted"',
        DOLLAR: "$HOME and ${OTHER}",
        HASH: "value # not a comment",
        EQUALS: "a=b=c",
        SPACED: "  leading and trailing  ",
        UNICODE: "café 🚀",
        EMPTY: "",
      }),
    ).toEqual([
      "--env",
      'QUOTED="quoted"',
      "--env",
      "DOLLAR=$HOME and ${OTHER}",
      "--env",
      "HASH=value # not a comment",
      "--env",
      "EQUALS=a=b=c",
      "--env",
      "SPACED=  leading and trailing  ",
      "--env",
      "UNICODE=café 🚀",
      "--env",
      "EMPTY=",
    ]);
  });

  it("refuses a key that is not an identifier", () => {
    expect(() => renderEnvArgs({ "not-a-key": "x" })).toThrow(RunError);
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

  it("passes env as argv, with the resolved port winning over a stored one", async () => {
    await withTempDir(async (dir) => {
      const { promise, exec } = deploy(dir);
      await promise;
      const run = exec.find("docker run")?.command ?? [];
      expect(run).not.toContain("--env-file");
      expect(run).toContain("DATABASE_URL=postgres://x");
      // Last --env wins in docker, so PORT has to come after the deployment's
      // own variables or an app is told to listen on the wrong one.
      expect(run.lastIndexOf("PORT=3000")).toBeGreaterThan(
        run.indexOf("DATABASE_URL=postgres://x"),
      );
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

describe("applyDeploymentEnv", () => {
  function apply(
    options: {
      healthStatuses?: (number | null)[];
      running?: boolean;
      missing?: boolean;
      responder?: ExecResponder;
    } = {},
  ) {
    const statuses = [...(options.healthStatuses ?? [200])];
    const request = deploymentRequest();
    const notes: string[] = [];
    let clock = 0;
    const exec = fakeExec((call) => {
      const line = call.command.join(" ");
      const override = options.responder?.(call);
      if (override !== undefined) return override;
      if (line.includes("{{json .Config.Image}}")) {
        return options.missing
          ? { exitCode: 1 }
          : {
              stdout:
                '"forge/app:abc1234-dep"\t["sh","-c","bun start"]\t{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"24817"}]}\n',
            };
      }
      if (call.command.includes("run")) return { stdout: "container-new\n" };
      if (line.includes("{{.State.Running}}")) {
        return {
          stdout:
            options.running === false ? "false false 1\n" : "true false 0\n",
        };
      }
      return undefined;
    });
    return {
      request,
      exec,
      notes,
      promise: applyDeploymentEnv({
        request,
        port: 24_817,
        network: "forge-apps",
        env: { DATABASE_URL: "postgres://new" },
        exec: exec.exec,
        healthProbe: async () => statuses.shift() ?? null,
        healthPollMs: 1,
        sleep: async () => {
          clock += 2_000;
        },
        now: () => clock,
        note: (message) => notes.push(message),
      }),
    };
  }

  it("recreates the container with the new env and removes the old one", async () => {
    const { promise, exec, request } = apply();
    const result = await promise;

    expect(result).toMatchObject({
      recreated: true,
      containerId: "container-new",
      healthy: true,
      rolledBack: false,
      error: null,
    });

    const name = containerNameFor(request.deploymentId);
    // Renamed aside, then stopped, before anything is created.
    expect(exec.commands).toContain(`docker rename ${name} ${name}-prev`);
    expect(exec.commands).toContain(`docker stop --time 10 ${name}-prev`);
    const run = exec.find("docker run")?.command ?? [];
    expect(run).toContain("DATABASE_URL=postgres://new");
    expect(run).toContain(`--name`);
    expect(run).toContain(name);
    // Same published port, so the Caddy route still points at it.
    expect(run).toContain("127.0.0.1:24817:3000");
    expect(exec.commands).toContain(`docker rm --force ${name}-prev`);
  });

  it("keeps the identical runtime flags as a first deploy", async () => {
    const { promise, exec, request } = apply();
    await promise;
    const run = exec.find("docker run")?.command ?? [];
    expect(run).toContain("--restart");
    expect(run).toContain("unless-stopped");
    expect(run).toContain("no-new-privileges");
    expect(run).toContain(`forge.deployment=${request.deploymentId}`);
    expect(run).toContain(`forge.kind=${request.kind}`);
    expect(
      run.slice(run.indexOf("--memory"), run.indexOf("--memory") + 2),
    ).toEqual(["--memory", `${request.runtime.memoryLimitMb}m`]);
  });

  it("restores the previous container when the replacement never answers", async () => {
    const { promise, exec, request } = apply({
      healthStatuses: [null],
      running: false,
    });
    const result = await promise;
    const name = containerNameFor(request.deploymentId);

    expect(result.recreated).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.error).toMatch(/previous container was restored/);
    expect(exec.commands).toContain(`docker rm --force ${name}`);
    expect(exec.commands).toContain(`docker rename ${name}-prev ${name}`);
    expect(exec.commands).toContain(`docker start ${name}`);
    // The old container must survive a failed apply. The only `rm` of the
    // aside name is the leftover sweep that runs before the rename.
    const removals = exec.commands.filter(
      (command) => command === `docker rm --force ${name}-prev`,
    );
    expect(removals).toHaveLength(1);
    expect(
      exec.commands.indexOf(`docker rm --force ${name}-prev`),
    ).toBeLessThan(exec.commands.indexOf(`docker rename ${name} ${name}-prev`));
  });

  it("reports honestly when the rollback itself fails", async () => {
    const { promise, request } = apply({
      healthStatuses: [null],
      running: false,
      responder: (call) => {
        const line = call.command.join(" ");
        if (line.startsWith("docker rename") && line.endsWith("-prev")) {
          return undefined;
        }
        if (line.startsWith("docker rename")) return { exitCode: 1 };
        return undefined;
      },
    });
    const result = await promise;
    expect(request.deploymentId).toBeTruthy();
    expect(result.rolledBack).toBe(false);
    expect(result.error).toMatch(/could not be restored/);
  });

  it("reuses the image and start command the container was created with", async () => {
    const { promise, exec } = apply();
    await promise;
    const run = exec.find("docker run")?.command ?? [];
    // Not the request's builder guess — the checkout that decided it is long
    // gone by the time anyone edits a variable.
    expect(run).toContain("forge/app:abc1234-dep");
    expect(run.slice(-3)).toEqual(["sh", "-c", "bun start"]);
    expect(run).toContain("127.0.0.1:24817:3000");
  });

  it("refuses when there is no container to recreate", async () => {
    const { promise, exec } = apply({ missing: true });
    const result = await promise;

    expect(result.recreated).toBe(false);
    expect(result.error).toMatch(/redeploy it instead/);
    // Nothing may be touched when the spec could not be read.
    expect(exec.find("docker run")).toBeUndefined();
    expect(exec.find("docker rename")).toBeUndefined();
  });

  it("clears a leftover -prev before renaming, so a retry is not stranded", async () => {
    const { promise, exec, request } = apply();
    await promise;
    const name = containerNameFor(request.deploymentId);
    expect(
      exec.commands.indexOf(`docker rm --force ${name}-prev`),
    ).toBeLessThan(exec.commands.indexOf(`docker rename ${name} ${name}-prev`));
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
