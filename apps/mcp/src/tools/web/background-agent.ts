import type { McpServer } from "@modelcontextprotocol/server";
import { createBackgroundAgentRunSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const runId = z.string().min(1).describe("Run id");
const byId = z.object({ runId });

export function registerWebBackgroundAgent(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_background_agent_runs",
    title: "Web: background agent runs",
    description: "Detached agent runs started from a prompt.",
    actions: {
      list: action({
        description: "Runs, optionally only the active ones",
        input: z.object({ active: z.boolean().optional() }),
        readOnly: true,
        run: ({ active }) =>
          api.web.get("/api/admin/background-agent/runs", { active }),
      }),
      create: action({
        description: "Starts a run; prompt or attachment required",
        input: z.object(createBackgroundAgentRunSchema.shape),
        run: (body) => api.web.post("/api/admin/background-agent/runs", body),
      }),
      get: action({
        description: "One run with its transcript",
        input: byId,
        readOnly: true,
        run: ({ runId }) =>
          api.web.get(p`/api/admin/background-agent/runs/${runId}`),
      }),
      delete: action({
        description: "Cancels and deletes a run",
        input: byId,
        destructive: true,
        run: ({ runId }) =>
          api.web.delete(p`/api/admin/background-agent/runs/${runId}`),
      }),
    },
  });
}
