import type { McpServer } from "@modelcontextprotocol/server";
import {
  agentTaskOriginSchema,
  createAgentTaskFeedbackSchema,
  createAgentTaskSchema,
  updateAgentTaskSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const taskId = z.string().min(1).describe("Task id");
const byId = z.object({ taskId });

// A task queued through this server was queued by an agent, and `origin` is
// the only control on unattended agent-scheduled tasks.
const createFields = {
  ...createAgentTaskSchema.shape,
  origin: agentTaskOriginSchema.default("agent"),
};

export function registerWebAgentTasks(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_agent_tasks",
    title: "Web: agent tasks",
    description: "Scheduled and one-off agent tasks and their runs.",
    actions: {
      list: action({
        description: "Tasks with recent runs",
        readOnly: true,
        run: () => api.web.get("/api/admin/agent-tasks"),
      }),
      create: action({
        description: "Creates a task; schedule or runAt, never both",
        input: z.object(createFields),
        run: (body) => api.web.post("/api/admin/agent-tasks", body),
      }),
      update: action({
        description: "Changes any field including status",
        input: z.object({ taskId, ...updateAgentTaskSchema.shape }),
        idempotent: true,
        run: ({ taskId, ...body }) =>
          api.web.patch(p`/api/admin/agent-tasks/${taskId}`, body),
      }),
      delete: action({
        description: "Deletes a task and its runs",
        input: byId,
        destructive: true,
        run: ({ taskId }) =>
          api.web.delete(p`/api/admin/agent-tasks/${taskId}`),
      }),
      run: action({
        description: "Runs a task now",
        input: byId,
        run: ({ taskId }) =>
          api.web.post(p`/api/admin/agent-tasks/${taskId}/run`),
      }),
      cron_preview: action({
        description: "Next occurrences of a cron expression",
        input: z.object({
          cron: z.string().min(1),
          timeZone: z.string().optional().describe("Defaults to app setting"),
        }),
        readOnly: true,
        run: (query) =>
          api.web.get("/api/admin/agent-tasks/cron-preview", query),
      }),
      run_feedback: action({
        description: "Records a verdict on a run (text required)",
        input: z.object({
          runId: z.string().min(1),
          ...createAgentTaskFeedbackSchema.shape,
        }),
        run: ({ runId, ...body }) =>
          api.web.post(p`/api/admin/agent-tasks/runs/${runId}/feedback`, body),
      }),
    },
  });
}
