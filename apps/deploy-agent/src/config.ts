import { requiredEnv } from "@repo/cloud-core";

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
  cacheRoot: string;
  dockerSocket: string;
  dockerDataRoot: string;
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
    cacheRoot: absolutePathEnv("CACHE_ROOT", "/srv/forge/cache"),
    dockerSocket: absolutePathEnv("DOCKER_SOCKET", "/var/run/docker.sock"),
    dockerDataRoot: absolutePathEnv("DOCKER_DATA_ROOT", "/var/lib/docker"),
  };
}
