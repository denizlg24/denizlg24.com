#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Brings up the Caddy the deploy agent publishes routes into.
 *
 * The agent owns Caddy's configuration outright — it does a full `POST /load`
 * on every change and there is no Caddyfile anywhere. So all this has to do is
 * get a Caddy running with its admin endpoint on the loopback address the
 * agent is configured to reach, holding a config with no servers in it. The
 * first deployment replaces that wholesale.
 *
 * Runs ahead of `dev:cloud` and must never be the reason it fails to start:
 * without Caddy installed it says so and exits 0. Builds still run in that
 * state — only the routing step at the end of a deploy fails, and it fails
 * with a connection error naming this port.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = resolve(root, ".forge-dev");
const configPath = resolve(stateDir, "caddy-bootstrap.json");
const logPath = resolve(stateDir, "caddy.log");
const down = process.argv.includes("--down");

const ADMIN_HOST = "127.0.0.1";
const ADMIN_PORT = 2019;

function skip(reason) {
  console.log(`[forge-caddy] skipped — ${reason}`);
  process.exit(0);
}

function portOpen(host, port) {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const settle = (open) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * `caddy stop` talks to the admin endpoint, so it reaches whichever Caddy is
 * listening — including one this script did not start. That is deliberate:
 * there is only ever one admin endpoint on this port to talk to.
 */
if (down) {
  if (!(await portOpen(ADMIN_HOST, ADMIN_PORT))) {
    skip("nothing listening on the admin port");
  }
  const stopped = spawnSync("caddy", ["stop"], { stdio: "inherit" });
  process.exit(stopped.status ?? 0);
}

if (await portOpen(ADMIN_HOST, ADMIN_PORT)) {
  console.log(`[forge-caddy] already running on ${ADMIN_HOST}:${ADMIN_PORT}`);
  process.exit(0);
}

if (spawnSync("caddy", ["version"], { stdio: "ignore" }).status !== 0) {
  skip("caddy is not installed (brew install caddy)");
}

await mkdir(stateDir, { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify(
    {
      admin: { listen: `${ADMIN_HOST}:${ADMIN_PORT}` },
      // No servers. The agent's first publish loads a `forge` server with
      // automatic_https disabled; anything defined here would be erased by it
      // and only serves to disagree with production in the meantime.
      apps: { http: { servers: {} } },
      logging: { logs: { default: { level: "ERROR" } } },
    },
    null,
    2,
  )}\n`,
);

// Detached with its own log file rather than inherited stdio: turbo's TUI owns
// the terminal for the three dev tasks, and a fourth process writing into it
// interleaves with them.
const log = openSync(logPath, "a");
const child = spawn("caddy", ["run", "--config", configPath], {
  detached: true,
  stdio: ["ignore", log, log],
});
child.unref();

for (let attempt = 0; attempt < 40; attempt += 1) {
  if (await portOpen(ADMIN_HOST, ADMIN_PORT)) {
    console.log(`[forge-caddy] admin on ${ADMIN_HOST}:${ADMIN_PORT}`);
    process.exit(0);
  }
  await new Promise((done) => setTimeout(done, 100));
}

console.log(`[forge-caddy] did not come up — see ${logPath}`);
process.exit(0);
