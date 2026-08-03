import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob } from "@/models/AgentMemoryJob";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun } from "@/models/AgentTaskRun";
import { InvalidCronExpressionError, nextCronOccurrence } from "./cron";

/**
 * The run row and the memory job that drives it have to arrive together. If the
 * job insert fails after the run exists, nothing re-creates it: the run sits at
 * `queued` for good, never starting and never failing. So a failed job insert
 * marks the run failed rather than leaving it orphaned.
 */
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
  // `findOneAndUpdate` is typed nullable even under `upsert`, and a concurrent
  // call racing the `{ taskId, scheduledFor }` unique index can lose.
  if (!run) throw new Error("Failed to enqueue agent task run");

  try {
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
  } catch (error) {
    await AgentTaskRun.updateOne(
      { _id: run._id, status: "queued" },
      {
        $set: {
          status: "failed",
          error: `Failed to enqueue worker job: ${String(error)}`,
          finishedAt: new Date(),
        },
      },
    ).catch(() => undefined);
    throw error;
  }
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
      // Only an unresolvable pattern parks the task: it would otherwise be
      // retried on every tick forever. A transient Mongo error or a duplicate
      // key race leaves the task active so the next tick can pick it up, rather
      // than requiring the owner to re-activate it by hand.
      if (error instanceof InvalidCronExpressionError) {
        task.status = "paused";
        task.nextRunAt = undefined;
        await task.save().catch(() => undefined);
      }
    }
  }
  return { scheduled };
}
