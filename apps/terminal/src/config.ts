import { requiredEnv } from "@repo/cloud-core";

export interface TerminalServiceConfig {
  host: string;
  idleSessionMs: number;
  port: number;
  ticketSecret: string;
  tmuxSocketName: string;
}

/**
 * Loopback alone cannot work when the API runs in a container: Docker's
 * inter-bridge isolation makes the host's docker0 address unroutable from a
 * custom compose network, and a loopback listener is unreachable from any
 * container regardless. The bind therefore has to be widened just enough to
 * cover an address the host answers on privately — in practice the Tailscale
 * address.
 *
 * The property worth keeping is "can never be reached from the public
 * internet", so wildcards and public addresses stay rejected. Private, CGNAT
 * (which is what Tailscale hands out) and link-local ranges are allowed.
 */
function isPrivateBindAddress(host: string): boolean {
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

export function terminalServiceConfigFromEnv(): TerminalServiceConfig {
  // Running as root is supported but never implicit: the unit has to opt in
  // with TERMINAL_ALLOW_ROOT, so a misconfiguration cannot silently hand out a
  // root shell.
  if (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    process.env.TERMINAL_ALLOW_ROOT !== "1"
  ) {
    throw new Error(
      "The terminal service refuses to run as root unless TERMINAL_ALLOW_ROOT=1",
    );
  }
  const host = process.env.HOST ?? "127.0.0.1";
  if (host === "0.0.0.0" || host === "::" || host === "*") {
    throw new Error("HOST must not be a wildcard address");
  }
  if (!isPrivateBindAddress(host)) {
    throw new Error(
      "HOST must be a loopback, private, link-local or CGNAT address",
    );
  }
  return {
    host,
    idleSessionMs:
      integerEnv("SESSION_IDLE_HOURS", 24, 1, 168) * 60 * 60 * 1_000,
    port: integerEnv("PORT", 3_003, 1, 65_535),
    ticketSecret: requiredEnv("TERMINAL_TICKET_SECRET"),
    tmuxSocketName: process.env.TMUX_SOCKET_NAME ?? "cloud-terminal",
  };
}
