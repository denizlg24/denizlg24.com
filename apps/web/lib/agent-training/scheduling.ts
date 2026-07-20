import { TZDate } from "@date-fns/tz";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTrainingRun } from "@/models/AgentTrainingRun";
import {
  AgentTrainingTask,
  type IAgentTrainingTask,
} from "@/models/AgentTrainingTask";

export function nextDailyOccurrence(options: {
  timeOfDay: string;
  timeZone: string;
  after?: Date;
}): Date {
  const after = options.after ?? new Date();
  const local = new TZDate(after.getTime(), options.timeZone);
  const [hour, minute] = options.timeOfDay.split(":").map(Number) as [
    number,
    number,
  ];
  let candidate = new TZDate(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    hour,
    minute,
    0,
    0,
    options.timeZone,
  );
  if (candidate.getTime() <= after.getTime()) {
    candidate = new TZDate(
      local.getFullYear(),
      local.getMonth(),
      local.getDate() + 1,
      hour,
      minute,
      0,
      0,
      options.timeZone,
    );
  }
  return new Date(candidate.getTime());
}

async function enqueueRun(options: {
  task: IAgentTrainingTask;
  trigger: "scheduled" | "manual";
  scheduledFor: Date;
}) {
  const run = await AgentTrainingRun.findOneAndUpdate(
    { taskId: options.task._id, scheduledFor: options.scheduledFor },
    {
      $setOnInsert: {
        taskId: options.task._id,
        taskName: options.task.name,
        trigger: options.trigger,
        status: "queued",
        scheduledFor: options.scheduledFor,
        toolCalls: [],
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  await AgentMemoryJob.findOneAndUpdate(
    { idempotencyKey: `training:${run._id.toString()}` },
    {
      $setOnInsert: {
        idempotencyKey: `training:${run._id.toString()}`,
        operation: "training",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        checkpoint: {
          trainingTaskId: options.task._id.toString(),
          trainingRunId: run._id.toString(),
        },
      },
    },
    { upsert: true },
  );
  return run;
}

export async function enqueueManualTrainingRun(taskId: string) {
  if (!Types.ObjectId.isValid(taskId))
    throw new Error("Training task not found");
  await connectDB();
  const task = await AgentTrainingTask.findById(taskId);
  if (!task || task.status === "archived") {
    throw new Error("Training task not found");
  }
  const scheduledFor = new Date();
  scheduledFor.setMilliseconds(0);
  return enqueueRun({ task, trigger: "manual", scheduledFor });
}

export async function scheduleDueTrainingRuns(now = new Date()) {
  await connectDB();
  const tasks = await AgentTrainingTask.find({
    status: "active",
    nextRunAt: { $lte: now },
  }).limit(50);
  let scheduled = 0;
  for (const task of tasks) {
    try {
      const scheduledFor = task.nextRunAt ?? now;
      await enqueueRun({ task, trigger: "scheduled", scheduledFor });
      task.lastRunAt = scheduledFor;
      task.nextRunAt = nextDailyOccurrence({
        timeOfDay: task.timeOfDay,
        timeZone: task.timeZone,
        after: now,
      });
      await task.save();
      scheduled += 1;
    } catch (error) {
      console.error("[Agent Training] Failed to schedule task", {
        taskId: task._id.toString(),
        error,
      });
    }
  }
  return { scheduled };
}
