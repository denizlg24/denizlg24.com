import { McpServer, type McpServerFactory } from "@modelcontextprotocol/server";
import pkg from "../package.json";
import { registerWhoami } from "./tools/whoami";
import type { Upstream } from "./upstream";

/**
 * One fresh server per request: serving is stateless, so every tool reads its
 * caller from the request context and nothing leaks between clients.
 */
export function mcpServerFactory(
  upstream: Upstream,
  origin: string,
): McpServerFactory {
  return () => {
    const server = new McpServer({
      name: "denizlg24",
      version: process.env.APP_VERSION ?? pkg.version,
      icons: [
        {
          src: `${origin}/icon.png`,
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
    });
    registerWhoami(server, upstream);
    return server;
  };
}
