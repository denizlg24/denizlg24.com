import type { AgentReleaseGates } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { getAgentMemorySettings } from "./settings";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60 * 1_000;

export function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

export function operationIsEnabled(
  operation: IAgentMemoryJob["operation"],
  gates: AgentReleaseGates,
): boolean {
  if (operation === "formation") return gates.formation;
  if (operation === "embedding") return gates.shadowRetrieval;
  if (operation === "embedding-cleanup") return gates.shadowRetrieval;
  if (operation === "reflection") return gates.reflection;
  if (operation === "insight") return gates.proactivity;
  if (operation === "backfill") return gates.evidenceLedger;
  if (operation === "resource-suggestion") return gates.formation;
  return gates.evidenceLedger;
}

export async function leaseNextMemoryJob(options: {
  workerId: string;
  operations: IAgentMemoryJob["operation"][];
  now?: Date;
}): Promise<IAgentMemoryJob | null> {
  const settings = await getAgentMemorySettings();
  const enabledOperations = options.operations.filter((operation) =>
    operationIsEnabled(operation, settings.releaseGates),
  );
  if (enabledOperations.length === 0) return null;

  await connectDB();
  const now = options.now ?? new Date();
  return AgentMemoryJob.findOneAndUpdate(
    {
      operation: { $in: enabledOperations },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [
        { status: { $in: ["pending", "retry"] }, availableAt: { $lte: now } },
        { status: "leased", leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "leased",
        leaseOwner: options.workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { availableAt: 1, createdAt: 1 } },
  );
}

// A worker that crashes after leasing a job for the MAX_ATTEMPTS-th time leaves
// it stuck in `leased`: the lease query excludes it via `attempts < MAX_ATTEMPTS`
// and nothing else moves it on. Dead-letter such orphaned leases once expired.
export async function sweepOrphanedLeases(now = new Date()): Promise<number> {
  await connectDB();
  const result = await AgentMemoryJob.updateMany(
    {
      status: "leased",
      leaseExpiresAt: { $lte: now },
      attempts: { $gte: MAX_ATTEMPTS },
    },
    {
      $set: { status: "dead-letter", completedAt: now },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    },
  );
  return result.modifiedCount;
}

export async function completeMemoryJob(
  jobId: string,
  workerId: string,
): Promise<boolean> {
  await connectDB();
  const result = await AgentMemoryJob.updateOne(
    { _id: jobId, status: "leased", leaseOwner: workerId },
    {
      $set: { status: "completed", completedAt: new Date() },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1, lastError: 1 },
    },
  );
  return result.modifiedCount === 1;
}

export async function requeueMemoryJob(options: {
  jobId: string;
  workerId: string;
  checkpoint: Record<string, unknown>;
  now?: Date;
}): Promise<boolean> {
  await connectDB();
  const result = await AgentMemoryJob.updateOne(
    { _id: options.jobId, status: "leased", leaseOwner: options.workerId },
    {
      $set: {
        status: "pending",
        attempts: 0,
        availableAt: options.now ?? new Date(),
        checkpoint: options.checkpoint,
      },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1, lastError: 1 },
    },
  );
  return result.modifiedCount === 1;
}

export async function failMemoryJob(options: {
  jobId: string;
  workerId: string;
  attempt: number;
  error: unknown;
  now?: Date;
}): Promise<boolean> {
  await connectDB();
  const now = options.now ?? new Date();
  const deadLetter = options.attempt >= MAX_ATTEMPTS;
  const message =
    options.error instanceof Error
      ? options.error.message
      : String(options.error);
  const result = await AgentMemoryJob.updateOne(
    { _id: options.jobId, status: "leased", leaseOwner: options.workerId },
    {
      $set: {
        status: deadLetter ? "dead-letter" : "retry",
        availableAt: new Date(now.getTime() + retryDelayMs(options.attempt)),
        lastError: message.slice(0, 4_096),
      },
      $unset: { leaseOwner: 1, leaseExpiresAt: 1 },
    },
  );
  return result.modifiedCount === 1;
}

export const AGENT_MEMORY_MAX_JOB_ATTEMPTS = MAX_ATTEMPTS;
