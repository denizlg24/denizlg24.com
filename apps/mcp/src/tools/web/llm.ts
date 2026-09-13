import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Api, action, defineActions, limit } from "../define";

export function registerWebLlm(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_llm",
    title: "Web: LLM",
    description: "Gateway model catalog and usage accounting.",
    actions: {
      models: action({
        description: "Catalog, filtered by creator and required capabilities",
        input: z.object({
          creator: z.string().optional(),
          requiredCapability: z.array(z.string()).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/llm/models", query),
      }),
      usage: action({
        description:
          "Totals and breakdowns plus a page of recent requests; section=recent pages only",
        input: z.object({
          section: z.literal("recent").optional(),
          offset: z.number().int().min(0).optional(),
          limit,
          lastId: z.string().optional().describe("Cursor from the last page"),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/llm/usage", query),
      }),
    },
  });
}
