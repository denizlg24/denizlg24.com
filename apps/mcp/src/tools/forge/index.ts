import type { McpServer } from "@modelcontextprotocol/server";
import type { Api } from "../define";
import { registerForgeDeployments } from "./deployments";
import { registerForgeGithub } from "./github";
import { registerForgeResources } from "./resources";
import { registerForgeTargets } from "./targets";

export function registerForge(server: McpServer, api: Api) {
  registerForgeGithub(server, api);
  registerForgeTargets(server, api);
  registerForgeDeployments(server, api);
  registerForgeResources(server, api);
}
