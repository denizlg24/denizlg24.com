import { mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  AgentDeploymentRequest,
  DeploymentPhase,
} from "@repo/schemas/cloud";

import type { BuildLog } from "./build-log";
import { BUILDER_NAME, ensureBuildxBuilder } from "./buildx";
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
 * Git will happily block on a credential prompt for a private repo, and a build
 * that hangs until the twenty-minute timeout looks nothing like "no access".
 */
const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_CONFIG_NOSYSTEM: "1",
  GCM_INTERACTIVE: "never",
};

const GIT_FLAGS = ["-c", "credential.helper=", "-c", "init.defaultBranch=main"];

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
  return Object.entries(env).flatMap(([key, value]) => [
    flag,
    `${key}=${value}`,
  ]);
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
      const exportsCache =
        cacheDirectory !== null &&
        (await ensureBuildxBuilder(exec, signal).catch(() => false));
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
              BUILDER_NAME,
              "--file",
              dockerfile ?? join(contextDirectory, "Dockerfile"),
              "--tag",
              imageTag,
              "--tag",
              latestTag,
              ...envFlags("--build-arg", buildEnv),
              // A container-driver builder cannot read the daemon's image
              // store, so the previous image is no use to it as a cache source
              // — the local cache below supersedes it and carries the cache
              // mounts the image never held.
              "--cache-from",
              `type=local,src=${cacheDirectory}`,
              "--cache-to",
              `type=local,dest=${cacheDirectory},mode=max`,
              // Without this the image stays in the builder and `docker run`
              // reports it as missing.
              "--load",
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
        env: { DOCKER_BUILDKIT: "1" },
        signal,
        timeoutMs: request.timeouts.buildMs,
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
      await execOrThrow(exec, "nixpacks build", {
        command: [
          "nixpacks",
          "build",
          ".",
          "--name",
          imageTag,
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
        env: { DOCKER_BUILDKIT: "1" },
        signal,
        timeoutMs: request.timeouts.buildMs,
        onOutput: (chunk) => log.write(chunk),
      });
      // Nixpacks tags one name; the moving tag is what makes the next build's
      // layer cache hit, so it is applied here rather than left to the builder.
      await execOrThrow(exec, "docker tag", {
        command: ["docker", "tag", imageTag, latestTag],
        signal,
        timeoutMs: 30_000,
      });
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
