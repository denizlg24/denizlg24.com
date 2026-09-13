import type { AgentReleaseGates } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { getAgentMemorySettings } from "./settings";

const MAX_ATTEMPTS = 5;
// A lease is how long a job may go quiet before another worker may take it.
// Agent turns have no step ceiling, so a worker running one keeps its lease
// alive with `withMemoryJobHeartbeat` rather than the lease being sized to the
// longest run imaginable.
export const AGENT_MEMORY_JOB_LEASE_MS = 6 * 60 * 1_000;
/** A third of the lease: two missed beats still leave it held. */
export const AGENT_MEMORY_JOB_HEARTBEAT_MS = 2 * 60 * 1_000;

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
  if (operation === "agent-task") return true;
  if (operation === "chat-run") return true;
  if (operation === "voice-transcription") return true;
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
        leaseExpiresAt: new Date(now.getTime() + AGENT_MEMORY_JOB_LEASE_MS),
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

export async function extendMemoryJobLease(options: {
  jobId: string;
  workerId: string;
  now?: Date;
}): Promise<Date> {
  await connectDB();
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + AGENT_MEMORY_JOB_LEASE_MS);
  await AgentMemoryJob.updateOne(
    { _id: options.jobId, status: "leased", leaseOwner: options.workerId },
    { $set: { leaseExpiresAt } },
  );
  return leaseExpiresAt;
}

/**
 * Runs `work` while re-extending the job's lease on an interval, handing each
 * new expiry to `onBeat` so the row being executed can carry the same
 * deadline. Without this a turn longer than one lease is re-leased by the
 * next drain and declared dead under a worker that is still running it.
 */
export async function withMemoryJobHeartbeat<T>(
  options: {
    jobId: string;
    workerId: string;
    onBeat: (leaseExpiresAt: Date) => Promise<void>;
  },
  work: () => Promise<T>,
): Promise<T> {
  const beat = async () => {
    try {
      const leaseExpiresAt = await extendMemoryJobLease(options);
      await options.onBeat(leaseExpiresAt);
    } catch (error) {
      console.warn("[Agent Memory] Job heartbeat failed", {
        jobId: options.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const timer = setInterval(() => void beat(), AGENT_MEMORY_JOB_HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
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
