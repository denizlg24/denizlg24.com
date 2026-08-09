import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentGcRequestSchema } from "@repo/schemas/cloud";

import type { ExecOptions, ExecResult } from "./exec";
import {
  builderPruneCommands,
  runGarbageCollection,
  selectDanglingToRemove,
  selectImagesToRemove,
} from "./gc";

const DANGLING = `sha256:${"a".repeat(64)}`;
const DANGLING_IN_USE = `sha256:${"b".repeat(64)}`;
const KEPT_DEPLOYMENT = "00000000-0000-4000-8000-000000000001";

function request(overrides: Record<string, unknown> = {}) {
  return agentGcRequestSchema.parse({
    keepDeploymentIds: [],
    keepImageTags: [],
    ...overrides,
  });
}

interface Scripted {
  exec: (options: ExecOptions) => Promise<ExecResult>;
  commands: string[][];
}

function scriptedExec(
  responses: Record<string, Partial<ExecResult>>,
): Scripted {
  const commands: string[][] = [];
  return {
    commands,
    exec: async (options) => {
      commands.push([...options.command]);
      const key = options.command.slice(0, 3).join(" ");
      const scripted = responses[key] ?? {};
      return {
        exitCode: scripted.exitCode ?? 0,
        stdout: scripted.stdout ?? "",
        stderr: scripted.stderr ?? "",
        timedOut: false,
        aborted: false,
      };
    },
  };
}

const NO_DISK = async () => {
  throw new Error("statfs is not available in this test");
};

async function withRoots<T>(
  run: (roots: {
    buildRoot: string;
    logRoot: string;
    cacheRoot: string;
  }) => Promise<T>,
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), "forge-gc-"));
  const roots = {
    buildRoot: join(base, "builds"),
    logRoot: join(base, "logs"),
    cacheRoot: join(base, "cache"),
  };
  await Promise.all(
    Object.values(roots).map((path) => mkdir(path, { recursive: true })),
  );
  try {
    return await run(roots);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

describe("selectImagesToRemove", () => {
  it("never reaps the moving cache tag", () => {
    expect(
      selectImagesToRemove(
        ["forge/app:latest", "forge/app:abc1234-0000", "forge/app:<none>"],
        [],
      ),
    ).toEqual(["forge/app:abc1234-0000"]);
  });

  it("keeps what the control plane still wants", () => {
    expect(
      selectImagesToRemove(
        ["forge/app:abc1234-0000", "forge/app:def5678-1111"],
        ["forge/app:def5678-1111"],
      ),
    ).toEqual(["forge/app:abc1234-0000"]);
  });
});

describe("selectDanglingToRemove", () => {
  it("spares an untagged image a kept container still runs", () => {
    expect(
      selectDanglingToRemove(
        [DANGLING, DANGLING_IN_USE, ""],
        [DANGLING_IN_USE],
      ),
    ).toEqual([DANGLING]);
  });
});

describe("builderPruneCommands", () => {
  it("sweeps the named builder and the daemon's own", () => {
    expect(builderPruneCommands("forge-hdd")).toEqual([
      ["docker", "buildx", "prune", "--builder", "forge-hdd"],
      ["docker", "builder", "prune"],
    ]);
  });

  it("sweeps only the daemon when no builder is configured", () => {
    expect(builderPruneCommands(null)).toEqual([
      ["docker", "builder", "prune"],
    ]);
  });
});

describe("runGarbageCollection", () => {
  it("reaps containers before images, and keeps the live ones", async () => {
    const keep = crypto.randomUUID();
    const { exec, commands } = scriptedExec({
      "docker ps --all": {
        stdout: [
          `c1\t${keep}\tforge/app:keep`,
          "c2\t00000000-0000-4000-8000-000000000002\tforge/app:old",
        ].join("\n"),
      },
      "docker images --filter": {
        stdout: "forge/app:keep\nforge/app:old\nforge/app:latest",
      },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request({ keepDeploymentIds: [keep] }), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      }),
    );

    expect(report.containersRemoved).toEqual(["c2"]);
    // The kept container's image is not offered to `docker rmi`, which would
    // fail — and a failure there is what makes the report unreadable.
    expect(report.imagesRemoved).toEqual(["forge/app:old"]);
    const removals = commands.filter((command) => command[1] === "rm");
    const images = commands.findIndex((command) => command[1] === "rmi");
    expect(removals.length).toBe(1);
    expect(images).toBeGreaterThan(commands.indexOf(removals[0] ?? []));
  });

  it("records a failed removal without failing the sweep", async () => {
    const { exec } = scriptedExec({
      "docker ps --all": {
        stdout: "c1\t00000000-0000-4000-8000-000000000003\tforge/app:old",
      },
      "docker rm --force": { exitCode: 1, stderr: "container is in use" },
      "docker images --filter": { stdout: "forge/app:old" },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request(), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      }),
    );

    expect(report.failures).toEqual([
      { step: "containers", subject: "c1", error: "container is in use" },
    ]);
    // The image of a container we could not remove stays: reaping it would only
    // produce a second failure describing the same problem.
    expect(report.imagesRemoved).toEqual([]);
  });

  it("deletes stale builds and logs and leaves fresh ones", async () => {
    const { exec } = scriptedExec({});
    const old = Date.now() - 40 * 24 * 60 * 60 * 1_000;

    const report = await withRoots(async (roots) => {
      await mkdir(join(roots.buildRoot, "stale"), { recursive: true });
      await utimes(join(roots.buildRoot, "stale"), old / 1_000, old / 1_000);
      await mkdir(join(roots.buildRoot, "fresh"), { recursive: true });
      await writeFile(join(roots.logRoot, "old.log"), "x");
      await utimes(join(roots.logRoot, "old.log"), old / 1_000, old / 1_000);
      await writeFile(join(roots.logRoot, "new.log"), "x");

      return runGarbageCollection(request(), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      });
    });

    expect(report.buildsRemoved).toEqual(["stale"]);
    expect(report.logsRemoved).toEqual(["old.log"]);
  });

  it("treats a zero cap as no size limit, not as no cache", async () => {
    const { exec } = scriptedExec({});

    const report = await withRoots(async (roots) => {
      const target = join(roots.cacheRoot, "target-a", "buildkit");
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "blob"), "x".repeat(4_096));

      return runGarbageCollection(request({ buildCacheMaxMb: 0 }), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      });
    });

    expect(report.cacheDirsRemoved).toEqual([]);
  });

  it("removes a cache directory that grew past its cap", async () => {
    const { exec } = scriptedExec({});

    const report = await withRoots(async (roots) => {
      const target = join(roots.cacheRoot, "target-a", "buildkit");
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "blob"), "x".repeat(2 * 1_048_576));
      await mkdir(join(roots.cacheRoot, "target-b"), { recursive: true });

      return runGarbageCollection(request({ buildCacheMaxMb: 1 }), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      });
    });

    expect(report.cacheDirsRemoved).toEqual(["target-a"]);
  });

  it("changes nothing on a dry run", async () => {
    const { exec, commands } = scriptedExec({
      "docker ps --all": {
        stdout: "c1\t00000000-0000-4000-8000-000000000004\tforge/app:old",
      },
      "docker images --filter": { stdout: "forge/app:old" },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request({ dryRun: true }), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: NO_DISK,
      }),
    );

    expect(report.containersRemoved).toEqual(["c1"]);
    expect(report.imagesRemoved).toEqual(["forge/app:old"]);
    expect(
      commands.some((command) => command[1] === "rm" || command[1] === "rmi"),
    ).toBe(false);
    expect(commands.some((command) => command[1] === "builder")).toBe(false);
  });

  it("reports the disk even when a step failed", async () => {
    const { exec } = scriptedExec({});
    const report = await withRoots((roots) =>
      runGarbageCollection(request(), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        statfsImplementation: async () => ({
          bsize: 4_096,
          blocks: 1_000,
          bfree: 400,
          bavail: 300,
        }),
      }),
    );

    expect(report.disk.freeBytes).toBe(300 * 4_096);
    expect(report.disk.error).toBeNull();
    expect(report.buildDisk?.freeBytes).toBe(300 * 4_096);
  });

  it("prunes the configured HDD-backed buildx builder", async () => {
    const { exec, commands } = scriptedExec({
      "docker buildx prune": { stderr: "Total: 1.5GB" },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request(), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        buildDataRoot: roots.buildRoot,
        buildxBuilder: "forge-hdd",
        statfsImplementation: NO_DISK,
      }),
    );

    const prune = commands.find(
      (command) => command[0] === "docker" && command[1] === "buildx",
    );
    expect(prune).toContain("--builder");
    expect(prune).toContain("forge-hdd");
    expect(report.builderCacheReclaimedBytes).toBe(1_500_000_000);
  });

  it("also prunes the daemon's own builder, and sums both", async () => {
    const { exec, commands } = scriptedExec({
      "docker buildx prune": { stderr: "Total: 1.5GB" },
      "docker builder prune": { stdout: "Total reclaimed space: 2GB" },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request(), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        buildDataRoot: roots.buildRoot,
        buildxBuilder: "forge-hdd",
        statfsImplementation: NO_DISK,
      }),
    );

    expect(
      commands.some(
        (command) => command.slice(0, 3).join(" ") === "docker builder prune",
      ),
    ).toBe(true);
    expect(report.builderCacheReclaimedBytes).toBe(3_500_000_000);
  });

  it("reaps untagged images the reference filter cannot see", async () => {
    const { exec, commands } = scriptedExec({
      "docker images --no-trunc": { stdout: `${DANGLING}\n${DANGLING_IN_USE}` },
      "docker ps --all": {
        stdout: `abc\t${KEPT_DEPLOYMENT}\t${DANGLING_IN_USE}`,
      },
    });

    const report = await withRoots((roots) =>
      runGarbageCollection(request({ keepDeploymentIds: [KEPT_DEPLOYMENT] }), {
        exec,
        ...roots,
        dockerDataRoot: "/var/lib/docker",
        buildDataRoot: roots.buildRoot,
        statfsImplementation: NO_DISK,
      }),
    );

    expect(report.imagesRemoved).toEqual([DANGLING]);
    expect(
      commands.filter(
        (command) => command[0] === "docker" && command[1] === "rmi",
      ),
    ).toEqual([["docker", "rmi", DANGLING]]);
  });
});
