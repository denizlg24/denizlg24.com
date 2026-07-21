import type {
  CreateAgentTrainingTask,
  UpdateAgentTrainingTask,
} from "@repo/schemas";
import { Types } from "mongoose";
import { findDeniedContent } from "@/lib/agent-memory/security";
import { getUnattendedModel } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone } from "@/lib/timezone";
import { AgentTrainingRun } from "@/models/AgentTrainingRun";
import { AgentTrainingTask } from "@/models/AgentTrainingTask";
import { nextDailyOccurrence } from "./scheduling";
import { serializeTrainingRun, serializeTrainingTask } from "./serialize";

export async function loadTrainingOverview() {
  await connectDB();
  const [tasks, runs, activeTasks, awaitingFeedback, learnedProcedureIds] =
    await Promise.all([
      AgentTrainingTask.find({ status: { $ne: "archived" } })
        .sort({ status: 1, updatedAt: -1 })
        .limit(100),
      AgentTrainingRun.find().sort({ createdAt: -1 }).limit(100),
      AgentTrainingTask.countDocuments({ status: "active" }),
      AgentTrainingRun.countDocuments({ status: "awaiting-feedback" }),
      AgentTrainingRun.distinct("feedback.learnedProcedureIds", {
        "feedback.learnedProcedureIds.0": { $exists: true },
      }),
    ]);
  return {
    tasks: tasks.map(serializeTrainingTask),
    runs: runs.map(serializeTrainingRun),
    stats: {
      activeTasks,
      awaitingFeedback,
      learnedProcedures: learnedProcedureIds.length,
    },
  };
}

function assertSafePrompt(prompt: string) {
  if (findDeniedContent(prompt).length > 0) {
    throw new Error("Training prompt contains secret-like content");
  }
}

export async function createTrainingTask(input: CreateAgentTrainingTask) {
  assertSafePrompt(input.prompt);
  await connectDB();
  const timeZone = await getAppTimeZone();
  const { model, ...fields } = input;
  const task = await AgentTrainingTask.create({
    ...fields,
    timeZone,
    llmModel: model ?? getUnattendedModel(),
    status: "active",
    autonomy: "yolo",
    nextRunAt: nextDailyOccurrence({
      timeOfDay: input.timeOfDay,
      timeZone,
    }),
  });
  return task;
}

export async function updateTrainingTask(
  taskId: string,
  input: UpdateAgentTrainingTask,
) {
  if (!Types.ObjectId.isValid(taskId))
    throw new Error("Training task not found");
  if (input.prompt) assertSafePrompt(input.prompt);
  await connectDB();
  const task = await AgentTrainingTask.findById(taskId);
  if (!task) throw new Error("Training task not found");
  const { model, ...fields } = input;
  task.set({ ...fields, ...(model ? { llmModel: model } : {}) });
  task.timeZone = await getAppTimeZone();
  if (task.status === "active") {
    task.nextRunAt = nextDailyOccurrence({
      timeOfDay: task.timeOfDay,
      timeZone: task.timeZone,
    });
  } else {
    task.nextRunAt = undefined;
  }
  await task.save();
  return task;
}
