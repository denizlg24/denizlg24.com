import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { processEmbeddingJob } from "@/lib/agent-memory/embedding";
import { processFormationJob } from "@/lib/agent-memory/formation";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
} from "@/lib/agent-memory/jobs";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";

const MAX_JOBS_PER_REQUEST = 10;

async function processJob(job: IAgentMemoryJob) {
  if (job.operation === "formation") return processFormationJob(job);
  if (job.operation === "embedding") return processEmbeddingJob(job);
  if (job.operation === "deletion") return { deleted: true };
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
    const job = await leaseNextMemoryJob({
      workerId,
      operations: ["formation", "embedding", "deletion"],
    });
    if (!job) break;
    try {
      results.push(await processJob(job));
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
