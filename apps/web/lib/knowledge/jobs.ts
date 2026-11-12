import { randomUUID } from "node:crypto";
import { knowledgeSourceKeySchema } from "@repo/schemas";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
  withMemoryJobHeartbeat,
} from "@/lib/agent-memory/jobs";
import type { IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { processKnowledgeSource } from "./process";
import { KNOWLEDGE_OPERATIONS } from "./queue";
import { processProjectionJob } from "./space";

export function isKnowledgeOperation(
  operation: IAgentMemoryJob["operation"],
): operation is (typeof KNOWLEDGE_OPERATIONS)[number] {
  return KNOWLEDGE_OPERATIONS.some((candidate) => candidate === operation);
}

export async function processKnowledgeJob(job: IAgentMemoryJob) {
  const checkpoint = job.checkpoint ?? {};
  if (job.operation === "knowledge-reindex") {
    const sourceKey = knowledgeSourceKeySchema.parse(checkpoint.sourceKey);
    return processKnowledgeSource(sourceKey);
  }
  if (job.operation === "knowledge-projection") {
    if (typeof checkpoint.scope !== "string") {
      throw new Error("Projection job has no scope");
    }
    return processProjectionJob(checkpoint.scope, checkpoint.force === true);
  }
  throw new Error(`Not a knowledge job: ${job.operation}`);
}

export async function drainKnowledgeJobs(
  max: number,
): Promise<{ completed: number; failed: number }> {
  const workerId = `knowledge:${randomUUID()}`;
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < max; index += 1) {
    const job = await leaseNextMemoryJob({
      workerId,
      operations: [...KNOWLEDGE_OPERATIONS],
    });
    if (!job) break;
    const jobId = job._id.toString();
    try {
      await withMemoryJobHeartbeat(
        { jobId, workerId, onBeat: async () => {} },
        () => processKnowledgeJob(job),
      );
      await completeMemoryJob(jobId, workerId);
      completed += 1;
    } catch (error) {
      await failMemoryJob({ jobId, workerId, attempt: job.attempts, error });
      failed += 1;
    }
  }
  return { completed, failed };
}
