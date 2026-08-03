import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun } from "@/models/AgentTaskRun";
import { nextCronOccurrence } from "./cron";

async function enqueueRun(options: {
  task: IAgentTask;
  trigger: "scheduled" | "manual";
  scheduledFor: Date;
}) {
  const run = await AgentTaskRun.findOneAndUpdate(
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
    { idempotencyKey: `agent-task:${run._id.toString()}` },
    {
      $setOnInsert: {
        idempotencyKey: `agent-task:${run._id.toString()}`,
        operation: "agent-task",
        evidenceIds: [],
        memoryIds: [],
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        checkpoint: {
          agentTaskId: options.task._id.toString(),
          agentTaskRunId: run._id.toString(),
        },
      },
    },
    { upsert: true },
  );
  return run;
}

export async function enqueueManualAgentTaskRun(taskId: string) {
  if (!Types.ObjectId.isValid(taskId)) throw new Error("Task not found");
  await connectDB();
  const task = await AgentTask.findById(taskId);
  if (!task || task.status === "archived") throw new Error("Task not found");
  const scheduledFor = new Date();
  scheduledFor.setMilliseconds(0);
  return enqueueRun({ task, trigger: "manual", scheduledFor });
}

export async function scheduleDueAgentTaskRuns(now = new Date()) {
  await connectDB();
  const tasks = await AgentTask.find({
    status: "active",
    schedule: { $exists: true },
    nextRunAt: { $lte: now },
  }).limit(50);

  let scheduled = 0;
  for (const task of tasks) {
    if (!task.schedule) continue;
    try {
      const scheduledFor = task.nextRunAt ?? now;
      await enqueueRun({ task, trigger: "scheduled", scheduledFor });
      task.lastRunAt = scheduledFor;
      // Advanced from `now`, not from the slot just fired: a task that was
      // paused or a worker that was down for a day should resume on the next
      // real slot rather than replay every one it missed.
      task.nextRunAt = nextCronOccurrence({
        cron: task.schedule.cron,
        timeZone: task.schedule.timeZone,
        after: now,
      });
      await task.save();
      scheduled += 1;
    } catch (error) {
      console.error("[Agent Tasks] Failed to schedule task", {
        taskId: task._id.toString(),
        error,
      });
      // A pattern that no longer resolves would otherwise be retried on every
      // scheduler tick forever. Park the task instead and surface it as paused.
      task.status = "paused";
      task.nextRunAt = undefined;
      await task.save().catch(() => undefined);
    }
  }
  return { scheduled };
}
