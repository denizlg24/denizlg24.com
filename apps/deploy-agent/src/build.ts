import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  AgentDeploymentRequest,
  DeploymentPhase,
} from "@repo/schemas/cloud";

import type { BuildLog } from "./build-log";
import { DEFAULT_BUILDER_NAME, ensureBuildxBuilder } from "./buildx";
import { type Exec, execOrThrow } from "./exec";

export type ResolvedBuilder = "dockerfile" | "nixpacks";

export interface BuildOptions {
  request: AgentDeploymentRequest;
  log: BuildLog;
  signal: AbortSignal;
  exec: Exec;
  buildRoot: string;
  /**
   * Per-target BuildKit cache root. Set to null to build through the classic
   * `docker build` path, which cannot export one.
   */
  cacheRoot?: string | null;
  /** Named buildx builder used for builds and pruned by Forge GC. */
  buildxBuilder?: string;
  /** Externally managed BuildKit daemon. When set, builds never fall back. */
  buildkitEndpoint?: string | null;
  /** Keep Bun install cache mounts mutually exclusive on rotational storage. */
  serializeBunInstalls?: boolean;
  /**
   * Narrow the pre-install copy in a generated Dockerfile to the manifests.
   * Set false to restore Nixpacks' own whole-tree copy — the escape hatch for a
   * repository whose install reads a file this cannot predict.
   */
  scopeInstallCopy?: boolean;
  /** Passed to `docker run`-style flags, e.g. `6144m`. */
  buildMemoryLimit: string;
  cloneToken?: string | null;
  /**
   * The deployment's environment. Passed as `--build-arg`, so every value here
   * is recoverable from the image's layer history — the platform makes no
   * build/run distinction, and a built image carries its secrets.
   */
  env?: Record<string, string>;
  onPhase?: (phase: DeploymentPhase) => Promise<void>;
  /**
   * The checkout, handed over once it is on disk and before anything is built.
   * Called for its side effects only — a build never fails because whatever
   * inspected the source did.
   */
  onCheckout?: (sourceDirectory: string) => Promise<void>;
  now?: () => number;
}

export interface BuildOutcome {
  imageTag: string;
  latestTag: string;
  builder: ResolvedBuilder;
  contextDirectory: string;
  buildDurationMs: number;
  imageSizeBytes: number | null;
}

export class BuildConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildConfigError";
  }
}

/**
 * Git will happily block on a credential prompt for a private repo, and a clone
 * that hangs until its own deadline looks nothing like "no access".
 */
const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_CONFIG_NOSYSTEM: "1",
  GCM_INTERACTIVE: "never",
};

const GIT_FLAGS = ["-c", "credential.helper=", "-c", "init.defaultBranch=main"];

const BUN_CACHE_MOUNT_TARGET = "target=/root/.bun";
const BUN_INSTALL_LOCK_MOUNT =
  "--mount=type=cache,id=forge-bun-install-lock,target=/tmp/forge-bun-install-lock,sharing=locked";

/**
 * Nixpacks gives every target its own Bun cache mount. That prevents cache
 * poisoning, but it also lets every concurrent build hammer the BuildKit
 * worker's HDD at once. An otherwise unused, worker-wide locked cache mount
 * acts as a mutex for just these install steps; the rest of each build remains
 * concurrent and each target keeps its warm package cache.
 */
export function serializeBunInstallSteps(dockerfile: string): string {
  return dockerfile
    .split("\n")
    .map((line) => {
      if (
        !line.startsWith("RUN ") ||
        !line.includes(BUN_CACHE_MOUNT_TARGET) ||
        line.includes(BUN_INSTALL_LOCK_MOUNT)
      ) {
        return line;
      }
      return line.replace("RUN ", `RUN ${BUN_INSTALL_LOCK_MOUNT} `);
    })
    .join("\n");
}

/**
 * Files that decide what a package manager installs. Anything here is copied
 * before the install step; everything else in the repository arrives after it.
 *
 * Deliberately wider than the lockfiles. A postinstall script is part of the
 * install, and it reads whatever it likes — this repository's own root install
 * runs `node scripts/fetch-tectonic.mjs`, which is not a manifest by any
 * definition and whose absence fails the install outright. `scripts`, `patches`
 * and `.husky` are therefore carried wholesale: they are small, and a build that
 * dies in a package manager's own words is a bad trade for a few kilobytes.
 */
const INSTALL_MANIFEST_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "bun.lock",
  "bun.lockb",
  "bunfig.toml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".nvmrc",
  ".node-version",
  // The Python provider installs from these, and nixpacks emits the same
  // copy-then-install shape for it.
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "pyproject.toml",
  "requirements.txt",
  "setup.cfg",
  "setup.py",
  "uv.lock",
]);

const INSTALL_MANIFEST_DIRECTORIES: ReadonlySet<string> = new Set([
  ".husky",
  "patches",
  "scripts",
]);

/** Never worth walking, and `node_modules` in particular is most of the tree. */
const UNWALKED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".next",
  ".nixpacks",
  ".turbo",
  "dist",
  "build",
  "node_modules",
  "target",
  "vendor",
]);

/** A workspace nested deeper than this is not a layout worth guessing at. */
const MANIFEST_WALK_DEPTH = 4;

/**
 * Every path in the checkout whose contents change what an install resolves.
 *
 * Enumerated from the checkout rather than emitted as globs on purpose: a glob
 * matching nothing — `apps/*` in a repository with no `apps` — is a hard `COPY`
 * failure, so a pattern that reads as harmless breaks every single-package
 * project. Real paths cannot miss.
 */
export async function collectInstallManifests(
  contextDirectory: string,
  depth = MANIFEST_WALK_DEPTH,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string, remaining: number): Promise<void> {
    const entries = await readdir(join(contextDirectory, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (INSTALL_MANIFEST_DIRECTORIES.has(entry.name)) {
          found.push(path);
          continue;
        }
        if (UNWALKED_DIRECTORIES.has(entry.name) || remaining <= 1) continue;
        await walk(path, remaining - 1);
        continue;
      }
      if (INSTALL_MANIFEST_FILES.has(entry.name)) found.push(path);
    }
  }

  await walk("", depth);
  return found.sort();
}

const INSTALL_COPY = /^COPY\s+\.\s+\/app\/?\.?\s*$/;

/**
 * Narrows the copy that precedes the install step to the manifests alone.
 *
 * Nixpacks copies the whole repository before installing, so any commit at all
 * invalidates the install layer — `bun install` was rebuilt on every single
 * build, 91 seconds and a 3.23 GB layer of it, for a set of dependencies that
 * had not moved in weeks. Scoping this one copy is what lets BuildKit reuse the
 * layer until a lockfile actually changes.
 *
 * Only the *first* full-tree copy is touched, and only when a `RUN` follows it
 * before any other one. That is the install phase by construction of nixpacks'
 * generator; the copies that follow the install are what put the source in the
 * image, and narrowing those would build the wrong tree.
 *
 * A no-op when there is nothing to copy — a repository with no recognised
 * manifest installs nothing, and an empty `COPY` is a build failure.
 */
export function scopeInstallCopy(
  dockerfile: string,
  manifests: readonly string[],
): string {
  if (manifests.length === 0) return dockerfile;
  const lines = dockerfile.split("\n");
  const first = lines.findIndex((line) => INSTALL_COPY.test(line));
  if (first === -1) return dockerfile;

  const following = lines.slice(first + 1);
  const nextCopy = following.findIndex((line) => INSTALL_COPY.test(line));
  const nextRun = following.findIndex((line) => line.startsWith("RUN "));
  if (nextRun === -1) return dockerfile;
  if (nextCopy !== -1 && nextCopy < nextRun) return dockerfile;

  // JSON form, because these paths come from walking the checkout and a
  // directory is allowed to have a space in its name. Space-separated, one
  // `apps/my app/package.json` becomes two sources, neither of which exists,
  // and `--parents` skips a missing source silently — so the install layer
  // would build without the manifest that was supposed to invalidate it.
  lines[first] = `COPY --parents ${JSON.stringify([...manifests, "/app/"])}`;
  return lines.join("\n");
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function imageTagFor(request: AgentDeploymentRequest): string {
  return `forge/${request.projectSlug}:${shortSha(request.repository.sha)}-${request.deploymentId.slice(0, 8)}`;
}

/** The moving tag that feeds `--cache-from`. Never reaped — see §2.6/§7.2. */
export function latestTagFor(request: AgentDeploymentRequest): string {
  return `forge/${request.projectSlug}:latest`;
}

export function cloneUrlFor(
  request: AgentDeploymentRequest,
  token: string | null | undefined,
): string {
  const { owner, name } = request.repository;
  const credential = token ? `x-access-token:${token}@` : "";
  return `https://${credential}github.com/${owner}/${name}.git`;
}

export function branchFor(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, "");
}

function resolveInside(root: string, relative: string | undefined): string {
  if (!relative || relative === ".") return root;
  if (isAbsolute(relative)) {
    throw new BuildConfigError(`Path must be relative: ${relative}`);
  }
  const resolved = resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new BuildConfigError(`Path escapes the checkout: ${relative}`);
  }
  return resolved;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function nixpacksConfigPath(
  contextDirectory: string,
  workingDirectory: string,
): Promise<string | null> {
  for (const filename of ["nixpacks.toml", "nixpacks.json"]) {
    const path = join(workingDirectory, filename);
    if (await exists(path)) return relative(contextDirectory, path);
  }
  return null;
}

async function isPythonWorkspace(workingDirectory: string): Promise<boolean> {
  for (const filename of [
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "main.py",
  ]) {
    if (await exists(join(workingDirectory, filename))) return true;
  }
  return false;
}

function pythonInstallCommand(command: string): string {
  const createsOptVenv =
    /python(?:3(?:\.\d+)?)?\s+-m\s+venv(?:\s+--\S+)*\s+\/opt\/venv/.test(
      command,
    );
  const activatesOptVenv =
    /(?:^|[;&|]\s*)(?:source|\.)\s+\/opt\/venv\/bin\/activate(?:\s|$)/.test(
      command,
    );
  if (createsOptVenv && activatesOptVenv) {
    return command;
  }
  // A CLI install override replaces Nixpacks' whole Python install phase,
  // including the virtualenv creation that makes pip available. Restore that
  // provider invariant before running the target's command.
  return `python -m venv --copies /opt/venv && . /opt/venv/bin/activate && ${command}`;
}

/**
 * `auto` is a default, not the whole story. Detection's failure mode is silent:
 * a stray Dockerfile in a repo root produces a baffling build with nothing
 * saying detection chose it — hence the log line, and hence the enum.
 *
 * Every path here is relative to the build context, which is the repository
 * root. `dockerfilePath` is therefore repository-relative — `apps/api/Dockerfile`,
 * not `Dockerfile` — because that is what `docker build --file` resolves against
 * once the context is the root.
 */
export async function resolveBuilder(
  request: AgentDeploymentRequest,
  contextDirectory: string,
  workingDirectory: string = contextDirectory,
): Promise<{ builder: ResolvedBuilder; dockerfile: string | null }> {
  const { builder, dockerfilePath } = request.build;
  const declared = dockerfilePath
    ? resolveInside(contextDirectory, dockerfilePath)
    : null;

  if (builder === "nixpacks") return { builder: "nixpacks", dockerfile: null };

  // The app's own Dockerfile before the repository's. A monorepo commonly has
  // both, and the one beside the app is the one that builds it.
  const conventional = join(workingDirectory, "Dockerfile");
  const rootLevel = join(contextDirectory, "Dockerfile");

  if (builder === "dockerfile") {
    const path =
      declared ?? ((await exists(conventional)) ? conventional : rootLevel);
    if (!(await exists(path))) {
      throw new BuildConfigError(
        `builder is "dockerfile" but ${dockerfilePath ?? "Dockerfile"} does not exist`,
      );
    }
    return { builder: "dockerfile", dockerfile: path };
  }

  if (declared) {
    if (!(await exists(declared))) {
      throw new BuildConfigError(
        `dockerfilePath ${dockerfilePath} does not exist`,
      );
    }
    return { builder: "dockerfile", dockerfile: declared };
  }

  for (const path of [conventional, rootLevel]) {
    if (await exists(path)) return { builder: "dockerfile", dockerfile: path };
  }
  return { builder: "nixpacks", dockerfile: null };
}

/**
 * A Dockerfile already states its own install, build and entrypoint; there is
 * nowhere sensible to inject an override. Accepting these and ignoring them is
 * how an evening disappears, so they are refused.
 */
export function assertCommandsSupported(
  request: AgentDeploymentRequest,
  builder: ResolvedBuilder,
): void {
  if (builder !== "dockerfile") return;
  const offending = (
    [
      ["installCommand", request.build.installCommand],
      ["buildCommand", request.build.buildCommand],
      // A Dockerfile states its own base image. Accepting a Node version here
      // and silently ignoring it is how someone spends an afternoon wondering
      // why the selector does nothing.
      ["nodeVersion", request.build.nodeVersion],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (offending.length > 0) {
    throw new BuildConfigError(
      `${offending.join(" and ")} cannot be used with the dockerfile builder; startCommand is the only run-time override`,
    );
  }
}

function envFlags(flag: string, env: Record<string, string>): string[] {
  // Docker build and Nixpacks both read a value from their own environment
  // when the flag carries only a name. Values in argv are world-readable via
  // /proc/<pid>/cmdline on Linux; the child environment is restricted to the
  // process owner and root.
  return Object.keys(env).flatMap((key) => [flag, key]);
}

/** Anything else is not a shell identifier and `export` would be a syntax error. */
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const BUILD_SECRET_ID = "forge-env";
/** Carries the blob to the buildx client. Never appears in argv. */
export const BUILD_SECRET_ENV_VAR = "FORGE_BUILD_ENV";

/**
 * The deployment's environment as a file a Dockerfile can `.` source.
 *
 * A Dockerfile only receives a `--build-arg` it declares, so the build of an
 * app that reads its config at module scope — which is most of them, and all of
 * `apps/web`'s API routes — sees none of it unless every name is written into
 * the Dockerfile by hand. That list is discovered one failed build at a time
 * and silently goes stale, so the whole set is handed over at once instead.
 *
 * Single quotes with `'\''` for embedded ones, because that is the only POSIX
 * quoting that is total: nothing inside `'…'` is special, so a value holding a
 * newline, a `$`, or a backtick survives intact. A PEM key is the case that
 * makes this matter — see the `--env` note in run.ts for the same problem on
 * the run side.
 */
export function shellEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([key]) => SHELL_NAME.test(key))
    .map(
      ([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'\n`,
    )
    .join("");
}

async function imageSize(
  exec: Exec,
  imageTag: string,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const result = await execOrThrow(exec, "docker image inspect", {
      command: [
        "docker",
        "image",
        "inspect",
        imageTag,
        "--format",
        "{{.Size}}",
      ],
      signal,
      timeoutMs: 30_000,
    });
    const size = Number(result.stdout.trim());
    return Number.isFinite(size) && size >= 0 ? size : null;
  } catch {
    // A size we could not read is a missing number in the UI, not a failed
    // deploy — the image exists either way, we just built it.
    return null;
  }
}

export async function runBuild(options: BuildOptions): Promise<BuildOutcome> {
  const { request, log, signal, exec } = options;
  const started = (options.now ?? Date.now)();
  const workspace = join(options.buildRoot, request.deploymentId);
  const source = join(workspace, "src");
  const cloneUrl = cloneUrlFor(request, options.cloneToken);
  log.protect(options.cloneToken);
  // Every var reaches the build now, so anything a build step echoes — a failing
  // command printing its environment, a framework dumping resolved config —
  // would otherwise put a credential in the log. `protect` ignores values too
  // short to redact without turning the log into a wall of asterisks.
  for (const value of Object.values(options.env ?? {})) log.protect(value);

  await rm(workspace, { recursive: true, force: true });
  await mkdir(source, { recursive: true });

  try {
    log.note(
      `cloning ${request.repository.owner}/${request.repository.name} at ${shortSha(request.repository.sha)}`,
    );
    await execOrThrow(exec, "git init", {
      command: ["git", ...GIT_FLAGS, "init", "--quiet"],
      cwd: source,
      env: GIT_ENV,
      signal,
      timeoutMs: 60_000,
    });

    // Fetching the SHA rather than the branch, because the branch may have
    // moved between the webhook and this build — and a deployment that claims
    // one commit while running another is the worst kind of wrong. No remote is
    // added, so the token never lands in .git/config.
    const fetchSha = await exec({
      command: [
        "git",
        ...GIT_FLAGS,
        "fetch",
        "--depth",
        "1",
        cloneUrl,
        request.repository.sha,
      ],
      cwd: source,
      env: GIT_ENV,
      signal,
      timeoutMs: 600_000,
      onOutput: (chunk) => log.write(chunk),
    });
    if (fetchSha.exitCode !== 0) {
      if (fetchSha.aborted) throw new Error("git fetch cancelled");
      if (fetchSha.timedOut) throw new Error("git fetch timed out");
      // Some servers refuse a bare-SHA want. Falling back to the ref still
      // checks out the requested SHA, and fails loudly if the shallow fetch
      // does not contain it.
      log.note("fetching by ref; the server refused a fetch by commit");
      await execOrThrow(exec, "git fetch", {
        command: [
          "git",
          ...GIT_FLAGS,
          "fetch",
          "--depth",
          "1",
          cloneUrl,
          branchFor(request.repository.ref),
        ],
        cwd: source,
        env: GIT_ENV,
        signal,
        timeoutMs: 600_000,
        onOutput: (chunk) => log.write(chunk),
      });
    }

    await execOrThrow(exec, "git checkout", {
      command: [
        "git",
        ...GIT_FLAGS,
        "checkout",
        "--detach",
        fetchSha.exitCode === 0 ? "FETCH_HEAD" : request.repository.sha,
      ],
      cwd: source,
      env: GIT_ENV,
      signal,
      timeoutMs: 120_000,
      onOutput: (chunk) => log.write(chunk),
    });

    await options.onCheckout?.(source).catch((error: unknown) => {
      log.note(
        `post-checkout inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    // The build context is the checkout root, never the selected directory.
    // A workspace's lockfile, its `turbo.json` and every package it depends on
    // live above it, so a context scoped to the app cannot install, let alone
    // build. `rootDirectory` instead selects where the commands run, and the
    // control plane has already written that into them as a `cd` prefix.
    const contextDirectory = source;
    const workingDirectory = resolveInside(source, request.build.rootDirectory);
    if (!(await exists(workingDirectory))) {
      throw new BuildConfigError(
        `rootDirectory ${request.build.rootDirectory} does not exist in the repository`,
      );
    }

    const { builder, dockerfile } = await resolveBuilder(
      request,
      contextDirectory,
      workingDirectory,
    );
    assertCommandsSupported(request, builder);

    const imageTag = imageTagFor(request);
    const latestTag = latestTagFor(request);
    const buildEnv = options.env ?? {};
    // The clone is seconds and the image build is minutes. Leaving the reported
    // phase on "cloning" for all of it is the stalled-spinner the phase field
    // exists to avoid.
    await options.onPhase?.("building");
    log.note(
      `building with ${builder}${dockerfile ? ` (${dockerfile})` : ""} → ${imageTag}`,
    );
    // Which directory the commands assume is not visible in the commands the
    // owner typed, and a build that installs in the wrong place fails several
    // minutes later in a package manager's own words.
    if (request.build.rootDirectory) {
      log.note(
        `context is the repository root; commands run in ${request.build.rootDirectory}`,
      );
    }

    if (builder === "dockerfile") {
      const cacheDirectory = options.cacheRoot
        ? join(options.cacheRoot, request.targetId, "buildkit")
        : null;
      // A builder we cannot create is a slower build, never a failed one.
      const builderName = options.buildxBuilder ?? DEFAULT_BUILDER_NAME;
      const usesExternalBuildkit = Boolean(options.buildkitEndpoint);
      const exportsCache =
        (cacheDirectory !== null || usesExternalBuildkit) &&
        (await ensureBuildxBuilder(exec, signal, {
          name: builderName,
          endpoint: options.buildkitEndpoint,
        }).catch(() => false));
      if (usesExternalBuildkit && !exportsCache) {
        throw new Error(
          `BuildKit builder ${builderName} is unavailable; refusing to build on the runtime disk`,
        );
      }
      if (cacheDirectory !== null && !exportsCache) {
        log.note(
          "no docker-container builder available; building without the cache-mount export",
        );
      }

      await execOrThrow(exec, "docker build", {
        command: exportsCache
          ? [
              "docker",
              "buildx",
              "build",
              "--builder",
              builderName,
              "--file",
              dockerfile ?? join(contextDirectory, "Dockerfile"),
              "--tag",
              imageTag,
              "--tag",
              latestTag,
              // Both, deliberately. The build args keep a Dockerfile that
              // declares `ARG NEXT_PUBLIC_…` working unchanged; the secret is
              // what a build needing the whole environment mounts. An arg no
              // Dockerfile declares is dropped by BuildKit, so passing them
              // costs nothing and puts nothing in the image's layer history.
              ...envFlags("--build-arg", buildEnv),
              "--secret",
              `id=${BUILD_SECRET_ID},env=${BUILD_SECRET_ENV_VAR}`,
              // A container-driver builder cannot read the daemon's image
              // store, so the previous image is no use to it as a cache source
              // — the local cache below supersedes it and carries the cache
              // mounts the image never held.
              ...(usesExternalBuildkit
                ? []
                : [
                    "--cache-from",
                    `type=local,src=${cacheDirectory}`,
                    "--cache-to",
                    `type=local,dest=${cacheDirectory},mode=max`,
                  ]),
              // The worker and Docker daemon are on the same host. `--load`
              // is shorthand for a gzip-compressed Docker export, which burns
              // CPU and makes the HDD-backed worker spend minutes in
              // "exporting layers" just to hand them to the local SSD. Docker
              // can load an uncompressed exporter stream directly.
              "--output",
              "type=docker,compression=uncompressed",
              "--progress",
              "plain",
              ".",
            ]
          : [
              "docker",
              "build",
              "--file",
              dockerfile ?? join(contextDirectory, "Dockerfile"),
              "--tag",
              imageTag,
              "--tag",
              latestTag,
              "--build-arg",
              "BUILDKIT_INLINE_CACHE=1",
              ...envFlags("--build-arg", buildEnv),
              // Also on the fallback path: a Dockerfile that mounts the secret
              // fails outright where it is not supplied, and which builder ran
              // is not something the repository can know.
              "--secret",
              `id=${BUILD_SECRET_ID},env=${BUILD_SECRET_ENV_VAR}`,
              "--cache-from",
              latestTag,
              "--memory",
              options.buildMemoryLimit,
              "--memory-swap",
              options.buildMemoryLimit,
              "--progress",
              "plain",
              ".",
            ],
        cwd: contextDirectory,
        env: {
          ...buildEnv,
          DOCKER_BUILDKIT: "1",
          // Through the child's environment block rather than its argv, for the
          // reason spelled out on the `--env` path in run.ts: `/proc/<pid>/cmdline`
          // is world-readable and `/proc/<pid>/environ` is not.
          [BUILD_SECRET_ENV_VAR]: shellEnvFile(buildEnv),
        },
        signal,
        onOutput: (chunk) => log.write(chunk),
      });
    } else {
      const { installCommand, buildCommand, startCommand, nodeVersion } =
        request.build;
      const nixpacksConfig = await nixpacksConfigPath(
        contextDirectory,
        workingDirectory,
      );
      const effectiveInstallCommand =
        installCommand && (await isPythonWorkspace(workingDirectory))
          ? pythonInstallCommand(installCommand)
          : installCommand;
      const nixpacksEnv = {
        PORT: "3000",
        ...(nodeVersion && !("NIXPACKS_NODE_VERSION" in buildEnv)
          ? { NIXPACKS_NODE_VERSION: nodeVersion }
          : {}),
        ...buildEnv,
      };
      const usesExternalBuildkit = Boolean(options.buildkitEndpoint);
      const builderName = options.buildxBuilder ?? DEFAULT_BUILDER_NAME;
      if (usesExternalBuildkit) {
        const available = await ensureBuildxBuilder(exec, signal, {
          name: builderName,
          endpoint: options.buildkitEndpoint,
        }).catch(() => false);
        if (!available) {
          throw new Error(
            `BuildKit builder ${builderName} is unavailable; refusing to build on the runtime disk`,
          );
        }
      }
      await execOrThrow(exec, "nixpacks build", {
        command: [
          "nixpacks",
          "build",
          ".",
          "--name",
          imageTag,
          ...(usesExternalBuildkit ? ["--out", "."] : []),
          // Scoped per target so two projects never poison each other's layers.
          "--cache-key",
          request.targetId,
          ...(nixpacksConfig ? ["--config", nixpacksConfig] : []),
          "--env",
          "PORT=3000",
          // Skipped outright when the target already sets the variable by
          // hand — the escape hatch for a repository the version list cannot
          // serve. Passing both and relying on nixpacks to prefer the later
          // `--env` would be resting on precedence nothing here verifies.
          ...(nodeVersion && !("NIXPACKS_NODE_VERSION" in buildEnv)
            ? ["--env", `NIXPACKS_NODE_VERSION=${nodeVersion}`]
            : []),
          ...envFlags("--env", buildEnv),
          ...(effectiveInstallCommand
            ? ["--install-cmd", effectiveInstallCommand]
            : []),
          ...(buildCommand ? ["--build-cmd", buildCommand] : []),
          ...(startCommand ? ["--start-cmd", startCommand] : []),
        ],
        cwd: contextDirectory,
        env: { ...nixpacksEnv, DOCKER_BUILDKIT: "1" },
        signal,
        onOutput: (chunk) => log.write(chunk),
      });
      if (usesExternalBuildkit) {
        // `nixpacks --out .` writes generated assets under `.nixpacks/` in
        // this disposable checkout without invoking Docker. The build context
        // must remain the repository root because the generated Dockerfile
        // copies application files from it.
        const generatedDockerfile = join(
          contextDirectory,
          ".nixpacks",
          "Dockerfile",
        );
        if (!(await exists(generatedDockerfile))) {
          throw new Error(
            "Nixpacks completed without generating .nixpacks/Dockerfile",
          );
        }
        const dockerfileContents = await readFile(generatedDockerfile, "utf8");
        let rewritten =
          options.serializeBunInstalls === false
            ? dockerfileContents
            : serializeBunInstallSteps(dockerfileContents);
        if (rewritten !== dockerfileContents) {
          log.note(
            "Bun installs share an HDD-backed cache; serializing install steps across builds",
          );
        }
        if (options.scopeInstallCopy !== false) {
          const manifests = await collectInstallManifests(contextDirectory);
          const scoped = scopeInstallCopy(rewritten, manifests);
          if (scoped !== rewritten) {
            rewritten = scoped;
            log.note(
              `install layer scoped to ${manifests.length} manifest paths; it now caches until one of them changes`,
            );
          }
        }
        if (rewritten !== dockerfileContents) {
          await writeFile(generatedDockerfile, rewritten);
        }
        await execOrThrow(exec, "docker buildx build", {
          command: [
            "docker",
            "buildx",
            "build",
            "--builder",
            builderName,
            "--file",
            join(".nixpacks", "Dockerfile"),
            "--tag",
            imageTag,
            "--tag",
            latestTag,
            ...envFlags("--build-arg", nixpacksEnv),
            // See the Dockerfile path above: this is a local hand-off, not a
            // registry transfer, so compression only adds export latency.
            "--output",
            "type=docker,compression=uncompressed",
            "--progress",
            "plain",
            ".",
          ],
          cwd: contextDirectory,
          env: { ...nixpacksEnv, DOCKER_BUILDKIT: "1" },
          signal,
          onOutput: (chunk) => log.write(chunk),
        });
      } else {
        // Nixpacks tags one name; the moving tag is what makes the next build's
        // layer cache hit, so it is applied here rather than left to the builder.
        await execOrThrow(exec, "docker tag", {
          command: ["docker", "tag", imageTag, latestTag],
          signal,
          timeoutMs: 30_000,
        });
      }
    }

    const buildDurationMs = (options.now ?? Date.now)() - started;
    const imageSizeBytes = await imageSize(exec, imageTag, signal);
    log.note(
      `built ${imageTag} in ${Math.round(buildDurationMs / 1_000)}s${imageSizeBytes === null ? "" : ` (${Math.round(imageSizeBytes / 1_048_576)} MB)`}`,
    );

    return {
      imageTag,
      latestTag,
      builder,
      contextDirectory,
      buildDurationMs,
      imageSizeBytes,
    };
  } finally {
    // The checkout is worth nothing once the image exists, and 140 GB of disk
    // is shared with every image on the box.
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
