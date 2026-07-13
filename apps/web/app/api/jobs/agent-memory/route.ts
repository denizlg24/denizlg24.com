import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { processBackfillJob } from "@/lib/agent-memory/backfill";
import { processEmbeddingJob } from "@/lib/agent-memory/embedding";
import { processFormationJob } from "@/lib/agent-memory/formation";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
  requeueMemoryJob,
} from "@/lib/agent-memory/jobs";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";

const MAX_JOBS_PER_REQUEST = 10;
const ACTIVE_OPERATIONS: IAgentMemoryJob["operation"][] = [
  "embedding",
  "formation",
  "backfill",
];

export function preferredOperationsForSlot(
  index: number,
): IAgentMemoryJob["operation"][] {
  return index % 2 === 0 ? ["embedding"] : ["formation", "backfill"];
}

async function leaseScheduledJob(workerId: string, index: number) {
  return (
    (await leaseNextMemoryJob({
      workerId,
      operations: preferredOperationsForSlot(index),
    })) ??
    leaseNextMemoryJob({
      workerId,
      operations: ACTIVE_OPERATIONS,
    })
  );
}

async function processJob(job: IAgentMemoryJob) {
  if (job.operation === "backfill") return processBackfillJob(job);
  if (job.operation === "formation") return processFormationJob(job);
  if (job.operation === "embedding") return processEmbeddingJob(job);
  throw new Error(`No agent-memory handler for ${job.operation}`);
}

export async function POST(request: Request) {
  const token = process.env.AGENT_MEMORY_JOB_BEARER_TOKEN;
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = `job-route:${randomUUID()}`;
  let completed = 0;
  let failed = 0;
  const results: unknown[] = [];
  for (let index = 0; index < MAX_JOBS_PER_REQUEST; index += 1) {
    const job = await leaseScheduledJob(workerId, index);
    if (!job) break;
    try {
      const result = await processJob(job);
      results.push(result);
      if (
        job.operation === "backfill" &&
        "done" in result &&
        result.done === false &&
        "checkpoint" in result
      ) {
        await requeueMemoryJob({
          jobId: job._id.toString(),
          workerId,
          checkpoint: { ...result.checkpoint },
        });
        continue;
      }
      await completeMemoryJob(job._id.toString(), workerId);
      completed += 1;
    } catch (error) {
      await failMemoryJob({
        jobId: job._id.toString(),
        workerId,
        attempt: job.attempts,
        error,
      });
      failed += 1;
    }
  }
  return NextResponse.json({ completed, failed, results });
}
