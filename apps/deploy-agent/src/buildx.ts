import type { Exec } from "./exec";

export const DEFAULT_BUILDER_NAME = "forge";

export interface BuildxBuilderOptions {
  name?: string;
  /**
   * A separately managed BuildKit daemon, for example
   * `docker-container://forge-buildkit`. Its state can live on another disk
   * while Docker keeps the loaded image and runtime layers on the SSD.
   */
  endpoint?: string | null;
}

/**
 * The default `docker` buildx driver cannot export a cache. That matters
 * because `--cache-from <previous image>` carries layers and nothing else: a
 * Dockerfile using `RUN --mount=type=cache` keeps its package-manager store in
 * the *builder's* cache, which the image does not contain. So the one thing
 * that makes a warm `bun install` fast is exactly the thing the default driver
 * drops on every build.
 *
 * A `docker-container` builder can export it, at the cost of `--load` copying
 * the finished image back into the daemon's store — seconds for a standalone
 * Next.js image, and the reason §2.4 insists on `output: "standalone"`.
 */
/**
 * `docker buildx inspect` prints one `Endpoint:` line per node. There is no
 * stable machine-readable form of it across the versions this host has run, so
 * the field is read out of the human output rather than through `--format`.
 */
export function builderEndpoints(inspectOutput: string): string[] {
  return inspectOutput
    .split("\n")
    .map((line) => /^\s*Endpoint:\s*(\S+)\s*$/.exec(line)?.[1])
    .filter((endpoint): endpoint is string => endpoint !== undefined);
}

export async function ensureBuildxBuilder(
  exec: Exec,
  signal: AbortSignal,
  options: BuildxBuilderOptions = {},
): Promise<boolean> {
  const name = options.name ?? DEFAULT_BUILDER_NAME;
  const inspected = await exec({
    command: ["docker", "buildx", "inspect", name],
    signal,
    timeoutMs: 60_000,
  });
  if (inspected.exitCode === 0) {
    // A builder is addressed by name, so one left over from an earlier layout
    // answers to the new name while still pointing at the old daemon — and the
    // build succeeds, writing its cache to whichever disk that daemon uses.
    // Nothing downstream can tell the difference, which makes the endpoint the
    // only thing worth checking here.
    if (!options.endpoint) return true;
    if (builderEndpoints(inspected.stdout).includes(options.endpoint)) {
      return true;
    }
    const removed = await exec({
      command: ["docker", "buildx", "rm", name],
      signal,
      timeoutMs: 120_000,
    });
    // Leaving the stale builder in place and returning false is the safe
    // failure: the caller refuses to build rather than silently using it.
    if (removed.exitCode !== 0) return false;
  }

  const driver = options.endpoint ? "remote" : "docker-container";
  const created = await exec({
    command: [
      "docker",
      "buildx",
      "create",
      "--name",
      name,
      "--driver",
      driver,
      ...(options.endpoint
        ? ["--driver-opt", "default-load=true", options.endpoint]
        : []),
      "--bootstrap",
    ],
    signal,
    timeoutMs: 300_000,
  });
  return created.exitCode === 0;
}
