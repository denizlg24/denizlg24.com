import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDeploymentRequest } from "@repo/schemas/cloud";
import {
  BUILD_SECRET_ENV_VAR,
  BUILD_SECRET_ID,
  BuildConfigError,
  branchFor,
  cloneUrlFor,
  collectInstallManifests,
  imageTagFor,
  runBuild,
  scopeInstallCopy,
  serializeBunInstallSteps,
  shellEnvFile,
} from "./build";

import { BuildLog } from "./build-log";
import type { ExecOptions } from "./exec";
import {
  deploymentRequest,
  type ExecResponder,
  fakeExec,
  withTempDir,
} from "./fixtures";

const TOKEN = "ghs_abcdefghijklmnopqrstuvwxyz";

function log(dir: string): BuildLog {
  return new BuildLog({ path: join(dir, "build.log") });
}

/** Fake `git` that materialises the checkout the rest of the build reads. */
function checkoutWriter(files: Record<string, string>) {
  return async (options: ExecOptions) => {
    if (options.command[0] !== "git") return undefined;
    if (options.command.includes("checkout") && options.cwd) {
      for (const [relative, contents] of Object.entries(files)) {
        const path = join(options.cwd, relative);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, contents);
      }
    }
    return undefined;
  };
}

async function build(
  dir: string,
  overrides: Parameters<typeof deploymentRequest>[0],
  files: Record<string, string>,
  makeResponder: (request: AgentDeploymentRequest) => ExecResponder = () =>
    checkoutWriter(files),
  agentOptions: {
    cacheRoot?: string;
    buildxBuilder?: string;
    buildkitEndpoint?: string;
    serializeBunInstalls?: boolean;
    scopeInstallCopy?: boolean;
  } = {},
) {
  const request = deploymentRequest(overrides);
  const exec = fakeExec(makeResponder(request));
  const buildLog = log(dir);
  const outcome = await runBuild({
    request,
    log: buildLog,
    signal: new AbortController().signal,
    exec: exec.exec,
    buildRoot: join(dir, "builds"),
    buildMemoryLimit: "6144m",
    cloneToken: TOKEN,
    ...agentOptions,
  });
  await buildLog.close();
  return { request, exec, outcome, text: buildLog.text };
}

describe("naming", () => {
  it("tags the image with the short SHA and the deployment prefix", () => {
    const request = deploymentRequest({
      projectSlug: "my-app",
      repository: {
        owner: "o",
        name: "r",
        ref: "refs/heads/main",
        sha: "a".repeat(40),
      },
    });
    expect(imageTagFor(request)).toBe(
      `forge/my-app:aaaaaaa-${request.deploymentId.slice(0, 8)}`,
    );
  });

  it("strips the ref prefix from a branch and a tag", () => {
    expect(branchFor("refs/heads/feat/x")).toBe("feat/x");
    expect(branchFor("refs/tags/v1.0.0")).toBe("v1.0.0");
    expect(branchFor("main")).toBe("main");
  });

  it("omits the credential entirely when there is no token", () => {
    const request = deploymentRequest();
    expect(cloneUrlFor(request, null)).toBe(
      "https://github.com/denizlg24/hello-world.git",
    );
  });
});

describe("serializeBunInstallSteps", () => {
  it("adds a worker-wide lock to Nixpacks Bun cache mounts", () => {
    const dockerfile =
      "RUN --mount=type=cache,id=target-a-/root/bun,target=/root/.bun bun install\n";

    const serialized = serializeBunInstallSteps(dockerfile);

    expect(serialized).toContain(
      "--mount=type=cache,id=forge-bun-install-lock,target=/tmp/forge-bun-install-lock,sharing=locked",
    );
    expect(serialized).toContain(
      "--mount=type=cache,id=target-a-/root/bun,target=/root/.bun bun install",
    );
  });

  it("does not change unrelated or already serialized steps", () => {
    const dockerfile = [
      "RUN --mount=type=cache,id=target-a-/root/npm,target=/root/.npm npm ci",
      "RUN --mount=type=cache,id=forge-bun-install-lock,target=/tmp/forge-bun-install-lock,sharing=locked --mount=type=cache,id=target-a-/root/bun,target=/root/.bun bun install",
      "",
    ].join("\n");

    expect(serializeBunInstallSteps(dockerfile)).toBe(dockerfile);
  });
});

/** The shape Nixpacks emits: copy everything, install, copy everything again. */
const NIXPACKS_DOCKERFILE = [
  "FROM ghcr.io/railwayapp/nixpacks:ubuntu",
  "WORKDIR /app/",
  "COPY . /app/.",
  "RUN --mount=type=cache,id=a-/root/bun,target=/root/.bun bun install",
  "COPY . /app/.",
  "RUN bunx turbo run build",
  "COPY . /app",
  'CMD ["bun", "start"]',
].join("\n");

describe("scopeInstallCopy", () => {
  it("narrows only the copy that precedes the install", () => {
    const scoped = scopeInstallCopy(NIXPACKS_DOCKERFILE, [
      "apps/cloud/package.json",
      "bun.lock",
      "package.json",
    ]);

    expect(scoped.split("\n")[2]).toBe(
      'COPY --parents ["apps/cloud/package.json","bun.lock","package.json","/app/"]',
    );
    // The copies after the install are what put the source in the image.
    expect(scoped).toContain("COPY . /app/.\nRUN bunx turbo run build");
    expect(scoped).toContain("COPY . /app\n");
  });

  it("keeps a path with a space in it as one source", () => {
    // The manifests come from walking the checkout, and a directory name is
    // allowed to contain a space. Space-separated this is two sources, both
    // missing, and `--parents` skips a missing source without failing — the
    // install layer would then be cached against a manifest it never copied.
    const scoped = scopeInstallCopy(NIXPACKS_DOCKERFILE, [
      "apps/my app/package.json",
      "package.json",
    ]);

    // The JSON array is what makes it one source rather than two: the
    // Dockerfile parser reads the whole bracketed list, spaces included.
    expect(scoped.split("\n")[2]).toBe(
      'COPY --parents ["apps/my app/package.json","package.json","/app/"]',
    );
  });

  it("leaves the Dockerfile alone when no manifest was found", () => {
    // An empty COPY is a build failure, and a repository with no manifest has
    // nothing to install anyway.
    expect(scopeInstallCopy(NIXPACKS_DOCKERFILE, [])).toBe(NIXPACKS_DOCKERFILE);
  });

  it("leaves a copy that no install follows alone", () => {
    // Two copies in a row means the first is not the install phase, and
    // narrowing it would build a tree missing its own source.
    const dockerfile = ["COPY . /app/.", "COPY . /app/.", "RUN echo hi"].join(
      "\n",
    );
    expect(scopeInstallCopy(dockerfile, ["package.json"])).toBe(dockerfile);
  });

  it("leaves a Dockerfile with no whole-tree copy alone", () => {
    const dockerfile = "FROM alpine\nRUN echo hi";
    expect(scopeInstallCopy(dockerfile, ["package.json"])).toBe(dockerfile);
  });
});

describe("collectInstallManifests", () => {
  it("finds workspace manifests and the scripts an install may read", async () => {
    await withTempDir(async (dir) => {
      for (const path of [
        "package.json",
        "bun.lock",
        "apps/cloud/package.json",
        "apps/envoy/prisma.config.ts",
        "apps/envoy/prisma/schema.prisma",
        "packages/schemas/package.json",
        "scripts/fetch-tectonic.mjs",
        "node_modules/left-pad/package.json",
        "apps/cloud/src/index.ts",
      ]) {
        await mkdir(join(dir, path, ".."), { recursive: true });
        await writeFile(join(dir, path), "{}");
      }

      const manifests = await collectInstallManifests(dir);

      expect(manifests).toEqual([
        "apps/cloud/package.json",
        "apps/envoy/prisma",
        "apps/envoy/prisma.config.ts",
        "bun.lock",
        "package.json",
        "packages/schemas/package.json",
        "scripts",
      ]);
      // The tree this exists to keep out of the install layer.
      expect(manifests).not.toContain("node_modules/left-pad/package.json");
    });
  });
});

describe("runBuild", () => {
  it("fetches the requested SHA and never stores the remote", async () => {
    await withTempDir(async (dir) => {
      const { request, exec } = await build(dir, {}, { Dockerfile: "FROM x" });
      const fetched = exec.find("fetch");
      expect(fetched?.command).toContain(request.repository.sha);
      expect(
        exec.commands.some((command) => command.includes("remote add")),
      ).toBe(false);
    });
  });

  it("refuses to let git block on a credential prompt", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(dir, {}, { Dockerfile: "FROM x" });
      expect(exec.find("fetch")?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    });
  });

  it("keeps the clone token out of the build log", async () => {
    await withTempDir(async (dir) => {
      const { text } = await build(dir, {}, { Dockerfile: "FROM x" }, () => {
        const responder = checkoutWriter({ Dockerfile: "FROM x" });
        return async (options) => {
          await responder(options);
          if (options.command.includes("fetch")) {
            options.onOutput?.(
              `remote: https://x-access-token:${TOKEN}@github.com/o/r.git rejected\n`,
            );
          }
          return undefined;
        };
      });
      expect(text).not.toContain(TOKEN);
      expect(text).toContain("***");
    });
  });

  it("falls back to fetching the ref when the server refuses a bare SHA", async () => {
    await withTempDir(async (dir) => {
      const { exec, request } = await build(
        dir,
        {},
        { Dockerfile: "FROM x" },
        (pending) => {
          const responder = checkoutWriter({ Dockerfile: "FROM x" });
          return async (options) => {
            await responder(options);
            if (
              options.command.includes("fetch") &&
              options.command.includes(pending.repository.sha)
            ) {
              return { exitCode: 128, stderr: "error: Server does not allow" };
            }
            return undefined;
          };
        },
      );
      const fetches = exec.calls.filter((call) =>
        call.command.includes("fetch"),
      );
      expect(fetches).toHaveLength(2);
      expect(fetches[1]?.command).toContain("main");
      expect(exec.find("checkout")?.command).toContain(request.repository.sha);
    });
  });

  it("builds with docker when a Dockerfile is present", async () => {
    await withTempDir(async (dir) => {
      const { outcome, exec } = await build(
        dir,
        {},
        { Dockerfile: "FROM scratch" },
      );
      expect(outcome.builder).toBe("dockerfile");
      const docker = exec.find("docker build");
      expect(docker?.env?.DOCKER_BUILDKIT).toBe("1");
      expect(docker?.command).toContain("--cache-from");
      expect(docker?.command).toContain(outcome.latestTag);
      expect(docker?.command).toContain("BUILDKIT_INLINE_CACHE=1");
      expect(docker?.timeoutMs).toBeUndefined();
    });
  });

  it("builds with nixpacks when there is no Dockerfile", async () => {
    await withTempDir(async (dir) => {
      const { outcome, exec, request } = await build(
        dir,
        {},
        { "package.json": "{}" },
      );
      expect(outcome.builder).toBe("nixpacks");
      const nixpacks = exec.find("nixpacks build");
      expect(nixpacks?.command).toContain("--cache-key");
      expect(nixpacks?.command).toContain(request.targetId);
      expect(nixpacks?.timeoutMs).toBeUndefined();
      // The moving tag has to exist on this path too or the next build's
      // --cache-from finds nothing.
      expect(exec.find("docker tag")?.command).toContain(outcome.latestTag);
    });
  });

  it("generates a Nixpacks Dockerfile and builds it on external BuildKit", async () => {
    await withTempDir(async (dir) => {
      const { exec, outcome, text } = await build(
        dir,
        {},
        { "package.json": "{}" },
        () => {
          const checkout = checkoutWriter({ "package.json": "{}" });
          return async (options) => {
            await checkout(options);
            if (options.command[0] === "nixpacks" && options.cwd) {
              const output = join(options.cwd, ".nixpacks");
              await mkdir(output, { recursive: true });
              await writeFile(
                join(output, "Dockerfile"),
                "FROM scratch\nRUN --mount=type=cache,id=target-a-/root/bun,target=/root/.bun bun install\n",
              );
            }
            return undefined;
          };
        },
        {
          buildxBuilder: "forge-hdd",
          buildkitEndpoint: "docker-container://forge-buildkit",
        },
      );

      expect(exec.find("nixpacks build")?.command).toContain("--out");
      const buildx = exec.find("docker buildx build");
      const command = buildx?.command ?? [];
      expect(command).toContain("forge-hdd");
      expect(command).toContain("--output");
      expect(command).toContain("type=docker,compression=uncompressed");
      expect(command).not.toContain("--load");
      expect(command).toContain(outcome.latestTag);
      expect(command.join(" ")).toContain(".nixpacks/Dockerfile");
      expect(buildx?.timeoutMs).toBeUndefined();
      expect(exec.find("docker tag")).toBeUndefined();
      expect(text).toContain("serializing install steps across builds");
    });
  });

  it("does not serialize Bun installs on an SSD-backed worker", async () => {
    await withTempDir(async (dir) => {
      let generatedDockerfile = "";
      const { text } = await build(
        dir,
        {},
        { "package.json": "{}" },
        () => {
          const checkout = checkoutWriter({ "package.json": "{}" });
          return async (options) => {
            await checkout(options);
            if (options.command[0] === "nixpacks" && options.cwd) {
              const output = join(options.cwd, ".nixpacks");
              await mkdir(output, { recursive: true });
              await writeFile(
                join(output, "Dockerfile"),
                "FROM scratch\nRUN --mount=type=cache,id=target-a-/root/bun,target=/root/.bun bun install\n",
              );
            }
            if (
              options.command[0] === "docker" &&
              options.command.includes("buildx") &&
              options.cwd
            ) {
              generatedDockerfile = await Bun.file(
                join(options.cwd, ".nixpacks", "Dockerfile"),
              ).text();
            }
            return undefined;
          };
        },
        {
          buildxBuilder: "forge-ssd",
          buildkitEndpoint: "docker-container://forge-buildkit",
          serializeBunInstalls: false,
        },
      );

      expect(generatedDockerfile).not.toContain("forge-bun-install-lock");
      expect(text).not.toContain("serializing install steps across builds");
    });
  });

  it("scopes the generated install copy to the checkout's manifests", async () => {
    await withTempDir(async (dir) => {
      const checkout = {
        "package.json": "{}",
        "bun.lock": "",
        "apps/cloud/package.json": "{}",
        "apps/cloud/src/index.ts": "export {};",
      };
      let generatedDockerfile = "";
      const { text } = await build(
        dir,
        {},
        checkout,
        () => {
          const writeCheckout = checkoutWriter(checkout);
          return async (options) => {
            await writeCheckout(options);
            if (options.command[0] === "nixpacks" && options.cwd) {
              const output = join(options.cwd, ".nixpacks");
              await mkdir(output, { recursive: true });
              await writeFile(
                join(output, "Dockerfile"),
                `${NIXPACKS_DOCKERFILE}\n`,
              );
            }
            if (
              options.command[0] === "docker" &&
              options.command.includes("buildx") &&
              options.cwd
            ) {
              generatedDockerfile = await Bun.file(
                join(options.cwd, ".nixpacks", "Dockerfile"),
              ).text();
            }
            return undefined;
          };
        },
        {
          buildxBuilder: "forge-ssd",
          buildkitEndpoint: "docker-container://forge-buildkit",
        },
      );

      expect(generatedDockerfile).toContain(
        'COPY --parents ["apps/cloud/package.json","bun.lock","package.json","/app/"]',
      );
      // Source still arrives, just after the layer that must not depend on it.
      expect(generatedDockerfile).toContain(
        "COPY . /app/.\nRUN bunx turbo run",
      );
      expect(generatedDockerfile).not.toContain(
        "apps/cloud/src/index.ts /app/",
      );
      expect(text).toContain("install layer scoped to 3 manifest paths");
    });
  });

  it("leaves the generated Dockerfile alone when scoping is disabled", async () => {
    await withTempDir(async (dir) => {
      const checkout = { "package.json": "{}" };
      let generatedDockerfile = "";
      const { text } = await build(
        dir,
        {},
        checkout,
        () => {
          const writeCheckout = checkoutWriter(checkout);
          return async (options) => {
            await writeCheckout(options);
            if (options.command[0] === "nixpacks" && options.cwd) {
              const output = join(options.cwd, ".nixpacks");
              await mkdir(output, { recursive: true });
              await writeFile(
                join(output, "Dockerfile"),
                `${NIXPACKS_DOCKERFILE}\n`,
              );
            }
            if (
              options.command[0] === "docker" &&
              options.command.includes("buildx") &&
              options.cwd
            ) {
              generatedDockerfile = await Bun.file(
                join(options.cwd, ".nixpacks", "Dockerfile"),
              ).text();
            }
            return undefined;
          };
        },
        {
          buildxBuilder: "forge-ssd",
          buildkitEndpoint: "docker-container://forge-buildkit",
          scopeInstallCopy: false,
        },
      );

      expect(generatedDockerfile).not.toContain("--parents");
      expect(text).not.toContain("install layer scoped");
    });
  });

  it("keeps Python project sources available to the install phase", async () => {
    await withTempDir(async (dir) => {
      const checkout = {
        "apps/classifier/pyproject.toml": "[project]\nname = 'classifier'",
        "apps/classifier/src/classifier/__init__.py": "",
      };
      let generatedDockerfile = "";
      const { text } = await build(
        dir,
        { build: { rootDirectory: "apps/classifier" } },
        checkout,
        () => {
          const writeCheckout = checkoutWriter(checkout);
          return async (options) => {
            await writeCheckout(options);
            if (options.command[0] === "nixpacks" && options.cwd) {
              const output = join(options.cwd, ".nixpacks");
              await mkdir(output, { recursive: true });
              await writeFile(
                join(output, "Dockerfile"),
                `${NIXPACKS_DOCKERFILE}\n`,
              );
            }
            if (
              options.command[0] === "docker" &&
              options.command.includes("buildx") &&
              options.cwd
            ) {
              generatedDockerfile = await Bun.file(
                join(options.cwd, ".nixpacks", "Dockerfile"),
              ).text();
            }
            return undefined;
          };
        },
        {
          buildxBuilder: "forge-ssd",
          buildkitEndpoint: "docker-container://forge-buildkit",
        },
      );

      expect(generatedDockerfile).not.toContain("--parents");
      expect(generatedDockerfile).toContain("COPY . /app/.");
      expect(text).not.toContain("install layer scoped");
    });
  });

  it("honours an explicit nixpacks builder over a present Dockerfile", async () => {
    await withTempDir(async (dir) => {
      const { outcome } = await build(
        dir,
        { build: { builder: "nixpacks" } },
        { Dockerfile: "FROM scratch" },
      );
      expect(outcome.builder).toBe("nixpacks");
    });
  });

  it("fails when builder is dockerfile and there is none", async () => {
    await withTempDir(async (dir) => {
      await expect(
        build(
          dir,
          { build: { builder: "dockerfile" } },
          { "package.json": "{}" },
        ),
      ).rejects.toBeInstanceOf(BuildConfigError);
    });
  });

  it("builds a workspace from the repository root, not from rootDirectory", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(
        dir,
        { build: { rootDirectory: "apps/web" } },
        { "apps/web/Dockerfile": "FROM scratch", "bun.lock": "" },
      );
      const command = exec.find("docker build");
      // A context scoped to apps/web leaves the root lockfile and every
      // workspace package it depends on outside the build entirely.
      expect(command?.cwd).not.toContain(join("apps", "web"));
      expect(command?.cwd?.endsWith("src")).toBe(true);
      // ...while the Dockerfile beside the app is still the one used.
      expect(command?.command.join(" ")).toContain(
        join("apps", "web", "Dockerfile"),
      );
    });
  });

  it("finds the app's Dockerfile before the repository's", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(
        dir,
        { build: { rootDirectory: "apps/web" } },
        { "apps/web/Dockerfile": "FROM scratch", Dockerfile: "FROM busybox" },
      );
      expect(exec.find("docker build")?.command.join(" ")).toContain(
        join("apps", "web", "Dockerfile"),
      );
    });
  });

  it("runs nixpacks from the repository root", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(
        dir,
        {
          build: {
            builder: "nixpacks",
            rootDirectory: "apps/web",
            installCommand: "bun install",
            buildCommand: "cd apps/web && bun run build",
          },
        },
        { "apps/web/package.json": "{}", "bun.lock": "" },
      );
      const command = exec.find("nixpacks build");
      expect(command?.cwd?.endsWith("src")).toBe(true);
      // The working directory arrives inside the command, written there by the
      // control plane's resolver — the agent holds no second notion of it.
      expect(command?.command.join(" ")).toContain(
        "cd apps/web && bun run build",
      );
    });
  });

  it("uses a selected workspace's Nixpacks provider config", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(
        dir,
        {
          build: {
            builder: "nixpacks",
            rootDirectory: "apps/classifier",
            installCommand: "cd apps/classifier && pip install .",
          },
        },
        {
          "apps/classifier/pyproject.toml": "[project]\nname='classifier'",
          "apps/classifier/nixpacks.toml": 'providers = ["python"]',
          "package.json": "{}",
        },
      );
      const command = exec.find("nixpacks build")?.command ?? [];
      expect(command).toContain("--config");
      expect(command).toContain("apps/classifier/nixpacks.toml");
      const installIndex = command.indexOf("--install-cmd");
      expect(installIndex).toBeGreaterThanOrEqual(0);
      expect(command[installIndex + 1]).toBe(
        "python -m venv --copies /opt/venv && . /opt/venv/bin/activate && cd apps/classifier && pip install .",
      );
    });
  });

  it("fails when rootDirectory is not in the repository", async () => {
    await withTempDir(async (dir) => {
      await expect(
        build(
          dir,
          { build: { rootDirectory: "apps/nope" } },
          { Dockerfile: "x" },
        ),
      ).rejects.toBeInstanceOf(BuildConfigError);
    });
  });

  it("rejects install and build commands on the dockerfile path", async () => {
    await withTempDir(async (dir) => {
      await expect(
        build(
          dir,
          { build: { buildCommand: "bun run build" } },
          { Dockerfile: "FROM scratch" },
        ),
      ).rejects.toThrow(/buildCommand cannot be used/);
    });
  });

  it("passes custom commands through to nixpacks", async () => {
    await withTempDir(async (dir) => {
      const { exec } = await build(
        dir,
        {
          build: {
            installCommand: "bun install",
            buildCommand: "bun run build",
            startCommand: "bun start",
          },
        },
        { "package.json": "{}" },
      );
      const command = exec.find("nixpacks build")?.command ?? [];
      expect(command).toContain("--install-cmd");
      expect(command).toContain("bun install");
      expect(command).toContain("--start-cmd");
    });
  });

  it("passes the deployment env to the build as build args", async () => {
    await withTempDir(async (dir) => {
      const request = deploymentRequest();
      const exec = fakeExec(checkoutWriter({ Dockerfile: "FROM scratch" }));
      const buildLog = log(dir);
      await runBuild({
        request,
        log: buildLog,
        signal: new AbortController().signal,
        exec: exec.exec,
        buildRoot: join(dir, "builds"),
        buildMemoryLimit: "6144m",
        env: { NEXT_PUBLIC_API_URL: "https://api.example.com" },
      });
      await buildLog.close();
      const call = exec.find("docker build");
      expect(call?.command).toContain("NEXT_PUBLIC_API_URL");
      expect(call?.command.join(" ")).not.toContain("https://api.example.com");
      expect(call?.env?.NEXT_PUBLIC_API_URL).toBe("https://api.example.com");
    });
  });

  it("hands the whole environment over as a mounted secret", async () => {
    await withTempDir(async (dir) => {
      const exec = fakeExec(checkoutWriter({ Dockerfile: "FROM scratch" }));
      const buildLog = log(dir);
      await runBuild({
        request: deploymentRequest(),
        log: buildLog,
        signal: new AbortController().signal,
        exec: exec.exec,
        buildRoot: join(dir, "builds"),
        buildMemoryLimit: "6144m",
        env: { RESEND_API_KEY: "re_live_1", MONGODB_URI: "mongodb://x" },
      });
      await buildLog.close();

      const call = exec.find("docker build");
      expect(call?.command).toContain(
        `id=${BUILD_SECRET_ID},env=${BUILD_SECRET_ENV_VAR}`,
      );
      // The value reaches the client through its environment, never argv.
      expect(call?.env?.[BUILD_SECRET_ENV_VAR]).toContain(
        "export RESEND_API_KEY='re_live_1'",
      );
      expect(call?.command.join(" ")).not.toContain("re_live_1");
      expect(call?.env?.RESEND_API_KEY).toBe("re_live_1");
    });
  });

  it("reports the image size it read back", async () => {
    await withTempDir(async (dir) => {
      const { outcome } = await build(
        dir,
        {},
        { Dockerfile: "FROM scratch" },
        () => {
          const responder = checkoutWriter({ Dockerfile: "FROM scratch" });
          return async (options) => {
            await responder(options);
            if (options.command.includes("image")) return { stdout: "1234\n" };
            return undefined;
          };
        },
      );
      expect(outcome.imageSizeBytes).toBe(1234);
    });
  });

  it("removes the checkout even when the build fails", async () => {
    await withTempDir(async (dir) => {
      const buildRoot = join(dir, "builds");
      const request = deploymentRequest();
      const exec = fakeExec(async (options) => {
        const responder = checkoutWriter({ Dockerfile: "FROM scratch" });
        await responder(options);
        if (options.command.includes("build")) {
          return { exitCode: 1, stderr: "boom" };
        }
        return undefined;
      });
      const buildLog = log(dir);
      await expect(
        runBuild({
          request,
          log: buildLog,
          signal: new AbortController().signal,
          exec: exec.exec,
          buildRoot,
          buildMemoryLimit: "6144m",
        }),
      ).rejects.toThrow(/docker build failed/);
      await buildLog.close();
      expect(
        await Bun.file(join(buildRoot, request.deploymentId, "src")).exists(),
      ).toBe(false);
    });
  });
});

describe("shellEnvFile", () => {
  it("emits sourceable exports", () => {
    expect(shellEnvFile({ A: "1", B: "two" })).toBe(
      "export A='1'\nexport B='two'\n",
    );
  });

  /**
   * The case the whole format exists for. A PEM key holds newlines and a
   * service-account JSON holds quotes and `$`; inside single quotes none of it
   * is special, so the only thing needing an escape is the quote itself.
   */
  it("survives newlines, quotes and shell metacharacters", () => {
    const value = '-----BEGIN KEY-----\nab\'cd$(x)`y`"z"\n-----END KEY-----';
    const rendered = shellEnvFile({ PEM: value });
    expect(rendered).toBe(
      `export PEM='-----BEGIN KEY-----\nab'\\''cd$(x)\`y\`"z"\n-----END KEY-----'\n`,
    );
  });

  it("drops names that are not shell identifiers", () => {
    // `export 1BAD=` is a syntax error, and it would take the build with it
    // rather than the one variable.
    expect(shellEnvFile({ "1BAD": "x", "a-b": "y", GOOD: "z" })).toBe(
      "export GOOD='z'\n",
    );
  });
});
