import { createAgentTaskSchema } from "@repo/schemas";
import { serializeAgentTask } from "@/lib/agent-tasks/serialize";
import {
  createAgentTask,
  resolveDefaultTimeZone,
  updateAgentTask,
} from "@/lib/agent-tasks/service";
import { connectDB } from "@/lib/mongodb";
import { AgentTask } from "@/models/AgentTask";
import type { ToolDefinition } from "./types";

export const agentTaskTools: ToolDefinition[] = [
  {
    schema: {
      name: "schedule_agent_task",
      description:
        "Schedule work for yourself to run later, unattended. Give either runAt for a single firing or cron for a repeating one. The task runs as a fresh agent with no memory of this conversation, so the prompt must carry everything needed to do the job. Fills happen on the task cron, so a run starts at the next tick after its time, not exactly on it.",
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short label for the task list",
          },
          prompt: {
            type: "string",
            description:
              "The full instruction for the future run. Self-contained: name the records, dates and thresholds involved rather than referring back to this conversation.",
          },
          runAt: {
            type: "string",
            description:
              "ISO 8601 datetime for a single firing. Mutually exclusive with cron.",
          },
          cron: {
            type: "string",
            description:
              "Five-field cron expression for a repeating task. Mutually exclusive with runAt.",
          },
          timeZone: {
            type: "string",
            description:
              "IANA time zone for the schedule. Defaults to the app's configured zone.",
          },
        },
        required: ["name", "prompt"],
      },
    },
    isWrite: true,
    category: "agent-tasks",
    execute: async (input) => {
      const timeZone =
        typeof input.timeZone === "string" && input.timeZone
          ? input.timeZone
          : await resolveDefaultTimeZone();
      const cron = typeof input.cron === "string" ? input.cron : undefined;
      const runAt = typeof input.runAt === "string" ? input.runAt : undefined;
      if (!cron && !runAt) {
        throw new Error("Provide runAt for a single run or cron for a repeat");
      }
      const parsed = createAgentTaskSchema.parse({
        name: input.name,
        prompt: input.prompt,
        schedule: cron ? { cron, timeZone } : undefined,
        runAt,
        origin: "agent",
      });
      return serializeAgentTask(await createAgentTask(parsed));
    },
  },
  {
    schema: {
      name: "list_agent_tasks",
      description:
        "List scheduled tasks and when they next fire, so you can see what you have already queued before adding more.",
      input_schema: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Narrow to tasks you scheduled or ones Deniz created",
            enum: ["agent", "owner"],
          },
        },
      },
    },
    isWrite: false,
    category: "agent-tasks",
    execute: async (input) => {
      await connectDB();
      const origin =
        input.origin === "agent" || input.origin === "owner"
          ? input.origin
          : undefined;
      const tasks = await AgentTask.find({
        status: { $ne: "archived" },
        ...(origin ? { origin } : {}),
      })
        .sort({ nextRunAt: 1, updatedAt: -1 })
        .limit(100);
      return tasks.map(serializeAgentTask);
    },
  },
  {
    schema: {
      name: "cancel_agent_task",
      description:
        "Archive a scheduled task so it stops firing. Its past runs are kept.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID from list_agent_tasks" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "agent-tasks",
    execute: async (input) => {
      return serializeAgentTask(
        await updateAgentTask(input.id as string, { status: "archived" }),
      );
    },
  },
];
