import { z } from "zod";

const configSchema = z.object({
  apiToken: z.string().min(32),
  dockerBinary: z.string().min(1),
  dockerHost: z.string().min(1),
  image: z.string().min(1),
  runtime: z.string().min(1),
  publicUrl: z.string().url(),
  memoryMb: z.number().int().min(128).max(4096),
  cpus: z.number().positive().max(4),
  pids: z.number().int().min(32).max(1024),
  maxSessions: z.number().int().min(1).max(100),
  requireRootless: z.boolean(),
});

export type SandboxConfig = z.infer<typeof configSchema>;

export function readConfig(env = process.env): SandboxConfig {
  const runtime = env.SANDBOX_CONTAINER_RUNTIME?.trim() || "runsc";
  if (env.NODE_ENV === "production" && runtime !== "runsc") {
    throw new Error(
      "Production sandbox execution requires SANDBOX_CONTAINER_RUNTIME=runsc",
    );
  }
  const image = env.SANDBOX_RUNTIME_IMAGE || "denizlg24/sandbox-runtime:local";
  if (env.NODE_ENV === "production" && !/@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error(
      "Production SANDBOX_RUNTIME_IMAGE must be pinned to an immutable sha256 digest",
    );
  }
  const dockerHost = env.SANDBOX_DOCKER_HOST || "unix:///var/run/docker.sock";
  if (
    env.NODE_ENV === "production" &&
    (!env.SANDBOX_DOCKER_HOST || dockerHost.includes("/var/run/docker.sock"))
  ) {
    throw new Error(
      "Production SANDBOX_DOCKER_HOST must name the dedicated sandbox daemon, never the system Docker socket",
    );
  }

  return configSchema.parse({
    apiToken: env.SANDBOX_API_TOKEN,
    dockerBinary: env.SANDBOX_DOCKER_BINARY || "docker",
    dockerHost,
    image,
    runtime,
    publicUrl: env.SANDBOX_PUBLIC_URL || "http://localhost:3005",
    memoryMb: Number(env.SANDBOX_MEMORY_MB || 1024),
    cpus: Number(env.SANDBOX_CPUS || 2),
    pids: Number(env.SANDBOX_PIDS_LIMIT || 256),
    maxSessions: Number(env.SANDBOX_MAX_SESSIONS || 8),
    requireRootless:
      env.SANDBOX_REQUIRE_ROOTLESS === undefined
        ? env.NODE_ENV === "production"
        : env.SANDBOX_REQUIRE_ROOTLESS === "true",
  });
}
