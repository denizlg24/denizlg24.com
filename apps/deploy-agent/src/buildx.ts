import { type Exec, execOrThrow } from "./exec";

export const BUILDER_NAME = "forge";

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
  name: string = BUILDER_NAME,
): Promise<boolean> {
  const inspected = await exec({
    command: ["docker", "buildx", "inspect", name],
    signal,
    timeoutMs: 60_000,
  });
  if (inspected.exitCode === 0) return true;

  const created = await exec({
    command: [
      "docker",
      "buildx",
      "create",
      "--name",
      name,
      "--driver",
      "docker-container",
      "--bootstrap",
    ],
    signal,
    timeoutMs: 300_000,
  });
  return created.exitCode === 0;
}
