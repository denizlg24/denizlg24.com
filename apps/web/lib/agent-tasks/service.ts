import type { CreateAgentTask, UpdateAgentTask } from "@repo/schemas";
import { Types } from "mongoose";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { getUnattendedModel } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun } from "@/models/AgentTaskRun";
import { nextCronOccurrence } from "./cron";
import { serializeAgentTask, serializeAgentTaskRun } from "./serialize";

export async function loadAgentTaskOverview() {
  await connectDB();
  const [tasks, runs, activeTasks, scheduledTasks, learnedProcedureIds] =
    await Promise.all([
      AgentTask.find({ status: { $ne: "archived" } })
        .sort({ status: 1, updatedAt: -1 })
        .limit(100),
      AgentTaskRun.find().sort({ createdAt: -1 }).limit(100),
      AgentTask.countDocuments({ status: "active" }),
      AgentTask.countDocuments({
        status: "active",
        schedule: { $exists: true },
      }),
      AgentTaskRun.distinct("feedback.learnedProcedureIds", {
        "feedback.learnedProcedureIds.0": { $exists: true },
      }),
    ]);
  return {
    tasks: tasks.map(serializeAgentTask),
    runs: runs.map(serializeAgentTaskRun),
    stats: {
      activeTasks,
      scheduledTasks,
      // A completed run nobody has commented on. Nothing blocks on this — it is
      // only how many runs still have a lesson left in them.
      runsAwaitingReview: runs.filter(
        (run) => run.status === "completed" && !run.feedback,
      ).length,
      learnedProcedures: learnedProcedureIds.length,
    },
  };
}

function assertSafePrompt(prompt: string) {
  if (findDeniedContent(prompt).length > 0) {
    throw new Error("Task prompt contains secret-like content");
  }
}

/**
 * A paused or archived task keeps its schedule but loses its `nextRunAt`, so
 * resuming it picks up from now rather than firing every slot it slept through.
 */
function applySchedule(task: IAgentTask) {
  if (task.status !== "active" || !task.schedule) {
    task.nextRunAt = undefined;
    return;
  }
  task.nextRunAt = nextCronOccurrence({
    cron: task.schedule.cron,
    timeZone: task.schedule.timeZone,
  });
}

export async function createAgentTask(input: CreateAgentTask) {
  assertSafePrompt(input.prompt);
  await connectDB();
  const { model, schedule, ...fields } = input;
  const task = new AgentTask({
    ...fields,
    schedule: schedule
      ? { cron: schedule.cron, timeZone: schedule.timeZone }
      : undefined,
    llmModel: model ?? (await getUnattendedModel()),
    status: "active",
  });
  applySchedule(task);
  await task.save();
  return task;
}

export async function updateAgentTask(taskId: string, input: UpdateAgentTask) {
  if (!Types.ObjectId.isValid(taskId)) throw new Error("Task not found");
  if (input.prompt) assertSafePrompt(input.prompt);
  await connectDB();
  const task = await AgentTask.findById(taskId);
  if (!task) throw new Error("Task not found");

  const { model, schedule, ...fields } = input;
  task.set(fields);
  if (model) task.llmModel = model;
  // `null` clears the schedule and makes the task manual-only; `undefined`
  // means the caller did not mention it and the current one stands.
  if (schedule !== undefined) {
    task.schedule = schedule
      ? { cron: schedule.cron, timeZone: schedule.timeZone }
      : undefined;
  }
  applySchedule(task);
  await task.save();
  return task;
}

export async function deleteAgentTask(taskId: string) {
  if (!Types.ObjectId.isValid(taskId)) throw new Error("Task not found");
  await connectDB();
  const task = await AgentTask.findByIdAndDelete(taskId);
  if (!task) throw new Error("Task not found");
  // Runs are the record of what the agent actually did to real data, so they
  // outlive the task definition that produced them.
  return { deletedRuns: 0 };
}

export async function resolveDefaultTimeZone() {
  return getAppTimeZone();
}
