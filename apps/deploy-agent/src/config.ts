import { requiredEnv } from "@repo/cloud-core";
import { DEFAULT_ACCESS_LOG_ROOT, DEFAULT_LISTEN } from "./caddy";

export interface AgentConfig {
  bindAddress: string;
  port: number;
  token: string;
  controlPlaneUrl: string;
  maxConcurrentBuilds: number;
  claimPollMs: number;
  heartbeatMs: number;
  buildRoot: string;
  logRoot: string;
  accessLogRoot: string;
  cacheRoot: string;
  dockerSocket: string;
  dockerDataRoot: string;
  buildxBuilder: string;
  buildkitEndpoint: string | null;
  /** Serialize Bun cache mounts when the BuildKit worker is rotational. */
  serializeBunInstalls: boolean;
  dockerNetwork: string;
  caddyAdminUrl: string;
  caddyListen: string;
  caddyStatePath: string;
  buildMemoryLimitMb: number;
  /** Held back for the OS, dockerd, this agent and Caddy. */
  memoryHeadroomMb: number;
  healthPollMs: number;
  drainMs: number;
}

/**
 * The agent can start containers and run builds as root, so the one property
 * that must hold unconditionally is "unreachable from the public internet".
 * Binding is therefore restricted to loopback, RFC1918, link-local and the
 * CGNAT range Tailscale assigns — the same rule apps/terminal enforces, for the
 * same reason.
 */
export function isPrivateBindAddress(host: string): boolean {
  if (host === "127.0.0.1" || host === "::1") return true;
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — CGNAT, the range Tailscale assigns.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function absolutePathEnv(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!value.startsWith("/")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function dockerNetworkEnv(): string {
  const value = process.env.DOCKER_NETWORK ?? "forge-apps";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    throw new Error("DOCKER_NETWORK is not a valid docker network name");
  }
  return value;
}

function buildxBuilderEnv(): string {
  const value = process.env.BUILDX_BUILDER?.trim() || "forge";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    throw new Error("BUILDX_BUILDER is not a valid buildx builder name");
  }
  return value;
}

function buildkitEndpointEnv(): string | null {
  const value = process.env.BUILDKIT_ENDPOINT?.trim();
  if (!value) return null;
  if (!value.startsWith("docker-container://")) {
    throw new Error(
      "BUILDKIT_ENDPOINT must use the docker-container:// transport",
    );
  }
  return value;
}

/**
 * Caddy's admin API is an unauthenticated remote-code-execution surface — it
 * loads arbitrary config, including handlers that execute. Caddy binds it to
 * loopback for that reason and so does this.
 */
function caddyAdminUrlEnv(): string {
  const raw = process.env.CADDY_ADMIN_URL ?? "http://127.0.0.1:2019";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CADDY_ADMIN_URL must be an absolute URL");
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("CADDY_ADMIN_URL must point at loopback");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function controlPlaneUrlEnv(): string {
  const raw = requiredEnv("CONTROL_PLANE_URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CONTROL_PLANE_URL must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("CONTROL_PLANE_URL must be http or https");
  }
  // Trailing slashes make every downstream join ambiguous; normalise once here
  // rather than defensively at each call site.
  return parsed.toString().replace(/\/+$/, "");
}

export function agentConfigFromEnv(): AgentConfig {
  const bindAddress = requiredEnv("AGENT_BIND_ADDRESS");
  if (
    bindAddress === "0.0.0.0" ||
    bindAddress === "::" ||
    bindAddress === "*"
  ) {
    throw new Error("AGENT_BIND_ADDRESS must not be a wildcard address");
  }
  if (!isPrivateBindAddress(bindAddress)) {
    throw new Error(
      "AGENT_BIND_ADDRESS must be a loopback, private, link-local or CGNAT address",
    );
  }

  const token = requiredEnv("AGENT_TOKEN");
  if (token.length < 32) {
    throw new Error("AGENT_TOKEN must be at least 32 characters");
  }

  return {
    bindAddress,
    port: integerEnv("AGENT_PORT", 4_010, 1, 65_535),
    token,
    controlPlaneUrl: controlPlaneUrlEnv(),
    maxConcurrentBuilds: integerEnv("MAX_CONCURRENT_BUILDS", 1, 1, 4),
    claimPollMs: integerEnv("CLAIM_POLL_MS", 3_000, 250, 60_000),
    heartbeatMs: integerEnv("HEARTBEAT_MS", 30_000, 1_000, 300_000),
    buildRoot: absolutePathEnv("BUILD_ROOT", "/srv/forge/builds"),
    logRoot: absolutePathEnv("LOG_ROOT", "/srv/forge/logs"),
    // Written by Caddy, read by this agent. Both run as `forge`, and the path
    // has to be in the Caddy unit's ReadWritePaths or every write fails.
    accessLogRoot: absolutePathEnv("ACCESS_LOG_ROOT", DEFAULT_ACCESS_LOG_ROOT),
    cacheRoot: absolutePathEnv("CACHE_ROOT", "/srv/forge/cache"),
    dockerSocket: absolutePathEnv("DOCKER_SOCKET", "/var/run/docker.sock"),
    dockerDataRoot: absolutePathEnv("DOCKER_DATA_ROOT", "/var/lib/docker"),
    buildxBuilder: buildxBuilderEnv(),
    buildkitEndpoint: buildkitEndpointEnv(),
    // Safe for the original HDD worker. The SSD migration opts out explicitly;
    // defaulting the other way would let an older agent.env overload the disk
    // as soon as a newer binary is deployed.
    serializeBunInstalls: booleanEnv("SERIALIZE_BUN_INSTALLS", true),
    dockerNetwork: dockerNetworkEnv(),
    caddyAdminUrl: caddyAdminUrlEnv(),
    caddyListen: process.env.CADDY_LISTEN?.trim() || DEFAULT_LISTEN,
    caddyStatePath: absolutePathEnv(
      "CADDY_STATE_PATH",
      "/srv/forge/caddy/config.json",
    ),
    buildMemoryLimitMb: integerEnv(
      "BUILD_MEMORY_LIMIT_MB",
      6_144,
      512,
      131_072,
    ),
    // Deliberately generous. Under-reserving here does not show up as a tidy
    // rejection — it shows up as the kernel picking something to kill while
    // every container is inside its own limit.
    memoryHeadroomMb: integerEnv("MEMORY_HEADROOM_MB", 1_024, 128, 131_072),
    healthPollMs: integerEnv("HEALTH_POLL_MS", 2_000, 250, 60_000),
    drainMs: integerEnv("CONTAINER_DRAIN_MS", 10_000, 0, 300_000),
  };
}
