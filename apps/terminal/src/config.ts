import { requiredEnv } from "@repo/cloud-core";

export interface TerminalServiceConfig {
  host: "127.0.0.1" | "::1";
  idleSessionMs: number;
  port: number;
  ticketSecret: string;
  tmuxSocketName: string;
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
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("The terminal service must not run as root");
  }
  const host = process.env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("HOST must be a loopback address (127.0.0.1 or ::1)");
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
