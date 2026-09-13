import type { McpServer } from "@modelcontextprotocol/server";
import type { Api } from "../define";
import { registerCloudDb } from "./db";
import { registerCloudOps } from "./ops";
import { registerCloudProjects } from "./projects";
import { registerCloudUsers } from "./users";

export function registerCloud(server: McpServer, api: Api) {
  registerCloudOps(server, api);
  registerCloudUsers(server, api);
  registerCloudProjects(server, api);
  registerCloudDb(server, api);
}
