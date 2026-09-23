import { mkdir } from "node:fs/promises";
import { createBrowserApp } from "./app";
import { BrowserPool } from "./browser-pool";
import { configFromEnv } from "./config";
import { startEgressProxy } from "./egress-proxy";
import { McpSessions, type PlaywrightMcpConfig } from "./mcp-sessions";
import { sweepOutputDir } from "./output-dir";

const config = configFromEnv();
const log = (message: string) => console.log(`[browser] ${message}`);
const onError = (error: unknown) => console.error("[browser]", error);
const OUTPUT_MAX_AGE_MS = 6 * 3_600_000;

await mkdir(config.outputDir, { recursive: true });
const outputSweep = setInterval(
  () => void sweepOutputDir(config.outputDir, OUTPUT_MAX_AGE_MS).catch(onError),
  30 * 60_000,
);

const proxy = startEgressProxy({
  port: config.proxyPort,
  allowPrivate: config.allowPrivateEgress,
  onRefused: (target, reason) => log(`egress refused ${target}: ${reason}`),
  onError,
});

const pool = new BrowserPool({
  proxyServer: `http://127.0.0.1:${proxy.port}`,
  viewport: config.viewport,
  maxSessions: config.maxSessions,
  sessionIdleMs: config.sessionIdleMs,
  ...(config.executablePath ? { executablePath: config.executablePath } : {}),
  onError,
});
pool.start();

const playwright: PlaywrightMcpConfig = {
  browser: {
    browserName: "chromium",
    // The pool hands every server its context; `isolated` would make the
    // server ask the browser for a fresh one, which SimpleBrowser refuses.
    isolated: false,
    launchOptions: { headless: true },
    contextOptions: { viewport: config.viewport },
  },
  capabilities: ["vision", "pdf"],
  imageResponses: "allow",
  outputDir: config.outputDir,
  saveSession: false,
  timeouts: { navigation: 30_000 },
};

const sessions = new McpSessions({
  pool,
  playwright,
  idleMs: config.mcpIdleMs,
  onError,
});
sessions.start();

const app = createBrowserApp({ config, pool, sessions });

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // Tool calls stream for as long as a navigation takes; the SSE keepalive
  // is what holds the connection, not Bun's idle window.
  idleTimeout: 0,
});

log(
  `listening on :${server.port}, egress proxy on :${proxy.port}${config.allowPrivateEgress ? " (private egress allowed)" : ""}`,
);

const shutdown = async () => {
  log("shutting down");
  clearInterval(outputSweep);
  await sessions.closeAll();
  await pool.close();
  await proxy.close();
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
