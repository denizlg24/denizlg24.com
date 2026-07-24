import { TerminalTicketService } from "@repo/cloud-core/terminal";

import { terminalServiceConfigFromEnv } from "./config";
import { createTerminalService } from "./service";

const config = terminalServiceConfigFromEnv();
const terminalService = createTerminalService({
  idleSessionMs: config.idleSessionMs,
  ticketService: new TerminalTicketService(config.ticketSecret),
});

const server = Bun.serve({
  fetch: terminalService.fetch,
  hostname: config.host,
  port: config.port,
  websocket: terminalService.websocket,
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  terminalService.close();
  server.stop(true);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`Cloud terminal listening on ${server.hostname}:${server.port}`);
