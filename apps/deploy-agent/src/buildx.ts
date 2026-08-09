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
  if (inspected.exitCode === 0) return true;

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
