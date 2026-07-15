import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processBackfillJob } from "@/lib/agent-memory/backfill";
import {
  processConsolidationJob,
  scheduleNextConsolidationJob,
} from "@/lib/agent-memory/consolidation";
import {
  processEmbeddingCleanupJob,
  processEmbeddingJob,
  scheduleNextEmbeddingCleanupJob,
} from "@/lib/agent-memory/embedding";
import { processFormationJob } from "@/lib/agent-memory/formation";
import {
  processInsightJob,
  scheduleNextInsightJob,
} from "@/lib/agent-memory/insights";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
  requeueMemoryJob,
  sweepOrphanedLeases,
} from "@/lib/agent-memory/jobs";
import {
  processReflectionJob,
  scheduleNextReflectionJob,
} from "@/lib/agent-memory/reflection";
import {
  processResourceSuggestionJob,
  scheduleNextResourceSuggestionJob,
} from "@/lib/agent-memory/resource-suggestions";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";

const MAX_JOBS_PER_REQUEST = 10;
const ACTIVE_OPERATIONS: IAgentMemoryJob["operation"][] = [
  "embedding",
  "embedding-cleanup",
  "formation",
  "backfill",
  "reflection",
  "insight",
  "consolidation",
  "resource-suggestion",
];

export function preferredOperationsForSlot(
  index: number,
): IAgentMemoryJob["operation"][] {
  if (index % 3 === 0) return ["embedding", "embedding-cleanup"];
  if (index % 3 === 1) return ["formation", "backfill"];
  return ["reflection", "insight", "consolidation", "resource-suggestion"];
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
  if (job.operation === "embedding-cleanup") {
    return processEmbeddingCleanupJob(job);
  }
  if (job.operation === "reflection") return processReflectionJob(job);
  if (job.operation === "insight") return processInsightJob(job);
  if (job.operation === "consolidation") return processConsolidationJob(job);
  if (job.operation === "resource-suggestion") {
    return processResourceSuggestionJob(job);
  }
  throw new Error(`No agent-memory handler for ${job.operation}`);
}

function isAuthorized(request: Request): boolean {
  const token = process.env.AGENT_MEMORY_JOB_BEARER_TOKEN;
  if (!token) return false;
  const provided = request.headers.get("Authorization");
  if (!provided) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function drainScheduledJobs(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = `job-route:${randomUUID()}`;
  await sweepOrphanedLeases();
  await scheduleNextReflectionJob();
  await scheduleNextInsightJob();
  await scheduleNextConsolidationJob();
  await scheduleNextResourceSuggestionJob();
  await scheduleNextEmbeddingCleanupJob();
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
        (job.operation === "backfill" || job.operation === "consolidation") &&
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

export async function POST(request: Request) {
  return drainScheduledJobs(request);
}

// Some external schedulers invoke this endpoint with GET; the shared drain
// loop is guarded by the same bearer token as POST.
export async function GET(request: Request) {
  return drainScheduledJobs(request);
}
