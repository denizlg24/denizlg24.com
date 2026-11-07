import { hostname } from "node:os";
import { CLOUD_AUTH_ISSUER, OAUTH_RESOURCES } from "@repo/schemas/cloud";
import { z } from "zod";

/**
 * gVisor's cgroup limits only take effect through this wrapper on the rootless
 * daemon; plain `runsc` accepts `--memory` and silently enforces nothing.
 */
export const RUNSC_WRAPPER_PATH = "/usr/local/bin/runsc-scoped";

const GIB = 1024 ** 3;

const PINNED_IMAGE =
  /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;

const cidrSchema = z
  .string()
  .regex(/^[0-9a-fA-F:.]+(?:\/\d{1,3})?$/, "Expected an address or CIDR");

const envSchema = z.object({
  AGENT_RUNNER_OAUTH_CLIENT_ID: z.string().trim().min(1),
  AGENT_RUNNER_OAUTH_CLIENT_SECRET: z.string().trim().min(1),
  AGENT_RUNNER_OAUTH_ISSUER: z.url().default(CLOUD_AUTH_ISSUER),
  AGENT_RUNNER_WEB_URL: z.url().default(OAUTH_RESOURCES.web),
  AGENT_RUNNER_WEB_RESOURCE: z.url().default(OAUTH_RESOURCES.web),
  AGENT_RUNNER_API_URL: z.url().default(OAUTH_RESOURCES.api),
  AGENT_RUNNER_API_RESOURCE: z.url().default(OAUTH_RESOURCES.api),
  /** The deploy agent's `/healthz`; it binds the tailnet address, not loopback. */
  AGENT_RUNNER_FORGE_HEALTH_URL: z.url(),
  AGENT_RUNNER_ROOT: z
    .string()
    .startsWith("/")
    .default("/mnt/storage/agent-runs"),
  AGENT_RUNNER_MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(2),
  AGENT_RUNNER_RUNTIME_IMAGE: z
    .string()
    .trim()
    .regex(
      PINNED_IMAGE,
      "AGENT_RUNNER_RUNTIME_IMAGE must be pinned by @sha256 digest",
    ),
  AGENT_RUNNER_CONTAINER_RUNTIME: z.enum(["runsc", "runc"]).default("runsc"),
  AGENT_RUNNER_NETWORK: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("agent-runs"),
  /** Linux caps interface names at 15 characters. */
  AGENT_RUNNER_BRIDGE: z
    .string()
    .regex(/^[a-z0-9-]{1,15}$/)
    .default("agent-runs0"),
  /** The host's own public addresses, beyond the private ranges always refused. */
  AGENT_RUNNER_BLOCKED_ADDRESSES: z.string().default(""),
  /** rootlesskit's `--state-dir`; holds `child_pid` and the detached `netns`. */
  AGENT_RUNNER_ROOTLESSKIT_STATE_DIR: z
    .string()
    .startsWith("/")
    .default("/run/user/1001/dockerd-rootless"),
  /**
   * Resolvers written into every run's /etc/resolv.conf. gVisor's netstack
   * cannot reach Docker's embedded resolver (127.0.0.11) on a user-defined
   * network, so runs resolve through public servers, which the egress rules
   * leave reachable.
   */
  AGENT_RUNNER_DNS: z
    .string()
    .default("1.1.1.1,9.9.9.9")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.ipv4()).min(1)),
  AGENT_RUNNER_GIT_NAME: z.string().trim().min(1),
  AGENT_RUNNER_GIT_EMAIL: z.email(),
  AGENT_RUNNER_MIN_MEM_AVAILABLE_GB: z.coerce.number().positive().default(10),
  AGENT_RUNNER_MIN_FREE_DISK_GB: z.coerce.number().positive().default(50),
  AGENT_RUNNER_ID: z.string().trim().min(1).max(200).optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().trim().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().trim().min(1).optional(),
  AGENT_RUNNER_GATEWAY_BASE_URL: z
    .url()
    .default("https://ai-gateway.vercel.sh"),
});

export interface RunnerConfig {
  runnerId: string;
  oauth: {
    issuer: string;
    clientId: string;
    clientSecret: string;
  };
  web: { url: string; resource: string };
  api: { url: string; resource: string };
  forgeHealthUrl: string;
  root: string;
  maxConcurrent: number;
  image: string;
  containerRuntime: "runsc" | "runc";
  network: string;
  bridge: string;
  blockedAddresses: string[];
  rootlesskitStateDir: string;
  dns: string[];
  git: { name: string; email: string };
  minMemAvailableBytes: number;
  minFreeDiskBytes: number;
  credentials: {
    subscriptionToken?: string;
    gatewayKey?: string;
    gatewayBaseUrl: string;
  };
}

export class ConfigError extends Error {}

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): RunnerConfig {
  const set = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value?.trim()),
  );
  const parsed = envSchema.safeParse(set);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid agent-runner environment: ${detail}`);
  }
  const value = parsed.data;
  const blocked = value.AGENT_RUNNER_BLOCKED_ADDRESSES.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of blocked) {
    if (!cidrSchema.safeParse(entry).success) {
      throw new ConfigError(
        `AGENT_RUNNER_BLOCKED_ADDRESSES: "${entry}" is not an address`,
      );
    }
  }
  if (!value.CLAUDE_CODE_OAUTH_TOKEN && !value.AI_GATEWAY_API_KEY) {
    throw new ConfigError(
      "Neither CLAUDE_CODE_OAUTH_TOKEN nor AI_GATEWAY_API_KEY is set; no run could authenticate",
    );
  }
  return {
    runnerId: value.AGENT_RUNNER_ID ?? `forge:${hostname()}`,
    oauth: {
      issuer: value.AGENT_RUNNER_OAUTH_ISSUER.replace(/\/$/, ""),
      clientId: value.AGENT_RUNNER_OAUTH_CLIENT_ID,
      clientSecret: value.AGENT_RUNNER_OAUTH_CLIENT_SECRET,
    },
    web: {
      url: value.AGENT_RUNNER_WEB_URL.replace(/\/$/, ""),
      resource: value.AGENT_RUNNER_WEB_RESOURCE,
    },
    api: {
      url: value.AGENT_RUNNER_API_URL.replace(/\/$/, ""),
      resource: value.AGENT_RUNNER_API_RESOURCE,
    },
    forgeHealthUrl: value.AGENT_RUNNER_FORGE_HEALTH_URL,
    root: value.AGENT_RUNNER_ROOT.replace(/\/$/, ""),
    maxConcurrent: value.AGENT_RUNNER_MAX_CONCURRENT,
    image: value.AGENT_RUNNER_RUNTIME_IMAGE,
    containerRuntime: value.AGENT_RUNNER_CONTAINER_RUNTIME,
    network: value.AGENT_RUNNER_NETWORK,
    bridge: value.AGENT_RUNNER_BRIDGE,
    blockedAddresses: blocked,
    rootlesskitStateDir: value.AGENT_RUNNER_ROOTLESSKIT_STATE_DIR.replace(
      /\/$/,
      "",
    ),
    dns: value.AGENT_RUNNER_DNS,
    git: {
      name: value.AGENT_RUNNER_GIT_NAME,
      email: value.AGENT_RUNNER_GIT_EMAIL,
    },
    minMemAvailableBytes: value.AGENT_RUNNER_MIN_MEM_AVAILABLE_GB * GIB,
    minFreeDiskBytes: value.AGENT_RUNNER_MIN_FREE_DISK_GB * GIB,
    credentials: {
      subscriptionToken: value.CLAUDE_CODE_OAUTH_TOKEN,
      gatewayKey: value.AI_GATEWAY_API_KEY,
      gatewayBaseUrl: value.AGENT_RUNNER_GATEWAY_BASE_URL,
    },
  };
}

/**
 * `docker info --format '{{json .Runtimes}}'`, checked before anything runs.
 * The configured runtime must exist, and `runsc` must be the scoped wrapper.
 */
export function assertRuntimeSupported(
  runtime: RunnerConfig["containerRuntime"],
  runtimesJson: string,
): void {
  let runtimes: unknown;
  try {
    runtimes = JSON.parse(runtimesJson);
  } catch {
    throw new ConfigError("docker info returned unreadable runtimes");
  }
  const entry = z
    .record(z.string(), z.object({ path: z.string().optional() }).loose())
    .safeParse(runtimes);
  if (!entry.success)
    throw new ConfigError("docker info returned unreadable runtimes");
  const configured = entry.data[runtime];
  if (!configured) {
    throw new ConfigError(`The sandbox daemon has no "${runtime}" runtime`);
  }
  if (runtime === "runsc" && configured.path !== RUNSC_WRAPPER_PATH) {
    throw new ConfigError(
      `runsc resolves to ${configured.path ?? "an unknown path"}, not ${RUNSC_WRAPPER_PATH}; its limits would be silently ignored`,
    );
  }
}
