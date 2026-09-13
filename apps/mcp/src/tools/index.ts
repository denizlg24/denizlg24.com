import type { McpServer } from "@modelcontextprotocol/server";
import type { Upstream } from "../upstream";
import { registerCloud } from "./cloud";
import { createApi } from "./define";
import { registerForge } from "./forge";
import { registerStorage } from "./storage";
import { registerWeb } from "./web";
import { registerWhoami } from "./whoami";

export function registerTools(server: McpServer, upstream: Upstream) {
  const api = createApi(upstream);
  registerWhoami(server, upstream);
  registerForge(server, api);
  registerCloud(server, api);
  registerStorage(server, api);
  registerWeb(server, api);
}
