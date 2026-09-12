import { createMcpApp } from "./app";
import { configFromEnv } from "./config";

const config = configFromEnv();
const app = createMcpApp({ config });

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // Streamed tool results and subscription streams stay open far longer than
  // Bun's default idle window.
  idleTimeout: 0,
});

console.log(
  `mcp listening on :${server.port} — resource ${config.resource}, issuer ${config.issuer}${config.service ? "" : " (no service client)"}`,
);
