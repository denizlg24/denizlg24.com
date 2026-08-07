import { mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

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
  buildEnv?: Record<string, string>;
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

/**
 * `auto` is a default, not the whole story. Detection's failure mode is silent:
 * a stray Dockerfile in a repo root produces a baffling build with nothing
 * saying detection chose it — hence the log line, and hence the enum.
 */
export async function resolveBuilder(
  request: AgentDeploymentRequest,
  contextDirectory: string,
): Promise<{ builder: ResolvedBuilder; dockerfile: string | null }> {
  const { builder, dockerfilePath } = request.build;
  const declared = dockerfilePath
    ? resolveInside(contextDirectory, dockerfilePath)
    : null;

  if (builder === "nixpacks") return { builder: "nixpacks", dockerfile: null };

  if (builder === "dockerfile") {
    const path = declared ?? join(contextDirectory, "Dockerfile");
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

  const conventional = join(contextDirectory, "Dockerfile");
  if (await exists(conventional)) {
    return { builder: "dockerfile", dockerfile: conventional };
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

    const contextDirectory = resolveInside(source, request.build.rootDirectory);
    if (!(await exists(contextDirectory))) {
      throw new BuildConfigError(
        `rootDirectory ${request.build.rootDirectory} does not exist in the repository`,
      );
    }

    const { builder, dockerfile } = await resolveBuilder(
      request,
      contextDirectory,
    );
    assertCommandsSupported(request, builder);

    const imageTag = imageTagFor(request);
    const latestTag = latestTagFor(request);
    const buildEnv = options.buildEnv ?? {};
    // The clone is seconds and the image build is minutes. Leaving the reported
    // phase on "cloning" for all of it is the stalled-spinner the phase field
    // exists to avoid.
    await options.onPhase?.("building");
    log.note(
      `building with ${builder}${dockerfile ? ` (${dockerfile})` : ""} → ${imageTag}`,
    );

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
      const { installCommand, buildCommand, startCommand } = request.build;
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
          "--env",
          "PORT=3000",
          ...envFlags("--env", buildEnv),
          ...(installCommand ? ["--install-cmd", installCommand] : []),
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
