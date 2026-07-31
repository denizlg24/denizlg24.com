#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Brings the markets relay up (or down) for local development.
 *
 * Runs ahead of `dev:web` and `dev:desktop`, so it must never be the reason
 * either fails to start. Without a Tiingo key, or without Docker running, it
 * prints why and exits 0 — the dashboard falls back to polling
 * /api/admin/markets/quotes, which is the same path production takes whenever
 * the relay is unreachable.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(
  root,
  "infra/compose/docker-compose.markets.dev.yml",
);
const envFile = resolve(root, ".env");
const down = process.argv.includes("--down");

function readEnv() {
  if (!existsSync(envFile)) return {};
  const values = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function skip(reason) {
  console.log(`[markets-relay] skipped — ${reason}`);
  console.log("[markets-relay] the dashboard will poll for quotes instead");
  process.exit(0);
}

const env = readEnv();

if (!down) {
  if (!env.TIINGO_API_KEY) skip("TIINGO_API_KEY is not set in .env");
  if (!env.MARKETS_RELAY_TOKEN_SECRET) {
    skip("MARKETS_RELAY_TOKEN_SECRET is not set in .env");
  }
  if (!env.NEXT_PUBLIC_MARKETS_RELAY_URL) {
    skip("NEXT_PUBLIC_MARKETS_RELAY_URL is not set in .env");
  }
}

const probe = spawnSync("docker", ["info"], { stdio: "ignore", shell: true });
if (probe.status !== 0) skip("Docker is not available");

const args = [
  "compose",
  "-f",
  composeFile,
  ...(down ? ["down"] : ["up", "-d", "--build", "--wait"]),
];

// Substitution comes from this process's environment rather than
// `--env-file .env`. Compose's parser is stricter than bun's and rejects
// unquoted special characters that the repo's .env legitimately contains, and
// there is no reason to show it every secret in the file to resolve three
// variables.
const result = spawnSync("docker", args, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    TIINGO_API_KEY: env.TIINGO_API_KEY ?? "",
    MARKETS_RELAY_TOKEN_SECRET: env.MARKETS_RELAY_TOKEN_SECRET ?? "",
    ...(env.MARKETS_RELAY_PORT
      ? { MARKETS_RELAY_PORT: env.MARKETS_RELAY_PORT }
      : {}),
    ...(env.MARKETS_RELAY_ALLOWED_ORIGINS
      ? { MARKETS_RELAY_ALLOWED_ORIGINS: env.MARKETS_RELAY_ALLOWED_ORIGINS }
      : {}),
  },
});

if (result.status !== 0) {
  if (down) process.exit(0);
  skip("docker compose could not start the relay");
}

if (down) process.exit(0);

const localUrl = `ws://localhost:${env.MARKETS_RELAY_PORT ?? 3004}/ws`;
console.log(`[markets-relay] container listening on ${localUrl}`);

// The browser connects to whatever NEXT_PUBLIC_MARKETS_RELAY_URL says, not to
// the container this script just started. Pointing at production while a local
// relay is running is a confusing way to debug nothing.
const configured = env.NEXT_PUBLIC_MARKETS_RELAY_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(configured)) {
  console.log(
    `[markets-relay] warning: NEXT_PUBLIC_MARKETS_RELAY_URL is ${configured}`,
  );
  console.log(
    `[markets-relay] the browser will use that, not the local container — set it to ${localUrl} to use this one`,
  );
}
