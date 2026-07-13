import { createHash, randomUUID } from "node:crypto";
import type { AgentSourceRef, AgentSourceType } from "@repo/schemas";
import mongoose, { type Types } from "mongoose";
import {
  processBackfillJob,
  scheduleAgentMemoryBackfill,
} from "@/lib/agent-memory/backfill";
import { processEmbeddingJob } from "@/lib/agent-memory/embedding";
import { observeConversationMessages } from "@/lib/agent-memory/evidence";
import { processFormationJob } from "@/lib/agent-memory/formation";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
  requeueMemoryJob,
} from "@/lib/agent-memory/jobs";
import { sourceRefIsExcluded } from "@/lib/agent-memory/policy";
import {
  processReflectionJob,
  scheduleNextReflectionJob,
} from "@/lib/agent-memory/reflection";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentMemory } from "@/models/AgentMemory";
import { AgentMemoryEmbedding } from "@/models/AgentMemoryEmbedding";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { Conversation } from "@/models/Conversation";

const PAGE_SIZE = 100;
const PROGRESS_INTERVAL = 25;
const MIGRATION_OPERATIONS = [
  "backfill",
  "formation",
  "embedding",
  "reflection",
] as const satisfies readonly IAgentMemoryJob["operation"][];
type MigrationOperation = (typeof MIGRATION_OPERATIONS)[number];

interface MigrationOptions {
  execute: boolean;
  formationBatchSize: number;
  generation: string;
  maxJobs: number;
  skipConversations: boolean;
}

interface JobBudget {
  remaining: number;
  processed: number;
}

interface MigrationEvidence {
  _id: Types.ObjectId;
  eventId: string;
  sourceType: AgentSourceType;
  sourceRef: AgentSourceRef;
}

function valueAfterEquals(argument: string): string | undefined {
  return argument.includes("=")
    ? argument.slice(argument.indexOf("=") + 1)
    : undefined;
}

export function parseMigrationOptions(args: string[]): MigrationOptions {
  const options: MigrationOptions = {
    execute: false,
    formationBatchSize: 8,
    generation: "full-v1",
    maxJobs: Number.POSITIVE_INFINITY,
    skipConversations: false,
  };
  for (const argument of args) {
    if (argument === "--execute") options.execute = true;
    else if (argument === "--skip-conversations")
      options.skipConversations = true;
    else if (argument.startsWith("--generation=")) {
      options.generation = valueAfterEquals(argument) ?? "";
    } else if (argument.startsWith("--formation-batch-size=")) {
      options.formationBatchSize = Number(valueAfterEquals(argument));
    } else if (argument.startsWith("--max-jobs=")) {
      options.maxJobs = Number(valueAfterEquals(argument));
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Agent-memory full migration

Usage:
  bun run agent-memory:migrate
  bun run agent-memory:migrate --execute [--max-jobs=N]

Options:
  --execute                 Perform writes and LLM/embedding calls (default is dry-run)
  --formation-batch-size=N  Combine untouched jobs into batches of 1-20 (default: 8)
  --generation=NAME         Idempotent canonical-domain rescan key (default: full-v1)
  --max-jobs=N              Stop after N leased job attempts; rerun to resume
  --skip-conversations      Do not ingest historical non-incognito conversations

Use a new generation name only when you intentionally want another complete
canonical-domain rescan. Existing evidence and jobs remain deduplicated.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(options.generation)) {
    throw new Error(
      "--generation must contain only lowercase letters, numbers, _ or -",
    );
  }
  if (
    !Number.isInteger(options.formationBatchSize) ||
    options.formationBatchSize < 1 ||
    options.formationBatchSize > 20
  ) {
    throw new Error("--formation-batch-size must be an integer from 1 to 20");
  }
  if (
    options.maxJobs !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(options.maxJobs) || options.maxJobs < 1)
  ) {
    throw new Error("--max-jobs must be a positive integer");
  }
  return options;
}

async function databaseSummary() {
  const [
    conversations,
    conversationMessages,
    eligibleEvidence,
    memories,
    activeMemories,
    embeddings,
    missingEmbeddings,
    jobRows,
  ] = await Promise.all([
    Conversation.countDocuments({ memoryMode: { $ne: "incognito" } }),
    Conversation.aggregate<{ count: number }>([
      { $match: { memoryMode: { $ne: "incognito" } } },
      { $project: { count: { $size: { $ifNull: ["$messages", []] } } } },
      { $group: { _id: null, count: { $sum: "$count" } } },
    ]),
    AgentEvidenceEvent.countDocuments({
      memoryEligible: true,
      redactedAt: { $exists: false },
    }),
    AgentMemory.countDocuments(),
    AgentMemory.countDocuments({ status: "active" }),
    AgentMemoryEmbedding.countDocuments(),
    AgentMemory.aggregate<{ count: number }>([
      { $match: { status: "active" } },
      {
        $lookup: {
          from: "agent_memory_embeddings",
          localField: "currentRevisionId",
          foreignField: "memoryRevisionId",
          as: "currentEmbeddings",
        },
      },
      { $match: { currentEmbeddings: { $size: 0 } } },
      { $count: "count" },
    ]),
    AgentMemoryJob.aggregate<{
      _id: { operation: string; status: string };
      count: number;
    }>([
      {
        $group: {
          _id: { operation: "$operation", status: "$status" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.operation": 1, "_id.status": 1 } },
    ]),
  ]);
  return {
    conversations,
    conversationMessages: conversationMessages[0]?.count ?? 0,
    eligibleEvidence,
    memories,
    activeMemories,
    embeddings,
    activeMemoriesMissingCurrentEmbedding: missingEmbeddings[0]?.count ?? 0,
    jobs: Object.fromEntries(
      jobRows.map((row) => [
        `${row._id.operation}:${row._id.status}`,
        row.count,
      ]),
    ),
  };
}

async function ingestHistoricalConversations() {
  const totals = {
    conversations: 0,
    assignedEventIds: 0,
    created: 0,
    duplicate: 0,
    skipped: 0,
    rejected: 0,
  };
  let cursor: Types.ObjectId | null = null;
  while (true) {
    const rows = await Conversation.find(cursor ? { _id: { $gt: cursor } } : {})
      .sort({ _id: 1 })
      .limit(PAGE_SIZE);
    if (rows.length === 0) break;
    for (const conversation of rows) {
      totals.conversations += 1;
      if (conversation.memoryMode === "incognito") {
        totals.skipped += conversation.messages.length;
        continue;
      }
      let assigned = 0;
      for (const message of conversation.messages) {
        const eventIdWasDefaulted =
          (
            message as typeof message & {
              $isDefault?: (path: string) => boolean;
            }
          ).$isDefault?.("eventId") === true;
        if (message.eventId && !eventIdWasDefaulted) continue;
        message.eventId ||= randomUUID();
        assigned += 1;
      }
      if (assigned > 0) {
        conversation.markModified("messages");
        await conversation.save();
        totals.assignedEventIds += assigned;
      }
      const observed = await observeConversationMessages({
        conversationId: conversation._id.toString(),
        memoryMode: conversation.memoryMode ?? "enabled",
        messages: conversation.messages,
      });
      totals.created += observed.created;
      totals.duplicate += observed.duplicate;
      totals.skipped += observed.skipped;
      totals.rejected += observed.rejected;
    }
    cursor = rows.at(-1)?._id ?? null;
    console.log(
      `[agent-memory:migrate] conversations=${totals.conversations} evidence-created=${totals.created} duplicates=${totals.duplicate}`,
    );
  }
  return totals;
}

async function ensureFormationJobs() {
  const settings = await getAgentMemorySettings();
  const totals = { scanned: 0, eligible: 0, scheduled: 0 };
  let cursor: Types.ObjectId | null = null;
  while (true) {
    const evidence: MigrationEvidence[] = await AgentEvidenceEvent.find({
      ...(cursor ? { _id: { $gt: cursor } } : {}),
      memoryEligible: true,
      redactedAt: { $exists: false },
    })
      .select("eventId sourceType sourceRef")
      .sort({ _id: 1 })
      .limit(500)
      .lean<MigrationEvidence[]>();
    if (evidence.length === 0) break;
    totals.scanned += evidence.length;
    const eligible = evidence.filter(
      (item) =>
        settings.enabledSources.includes(item.sourceType) &&
        !sourceRefIsExcluded(item.sourceRef, settings.excludedSourceRefs),
    );
    totals.eligible += eligible.length;
    if (eligible.length > 0) {
      const result = await AgentMemoryJob.bulkWrite(
        eligible.map((item) => ({
          updateOne: {
            filter: { idempotencyKey: `formation:${item.eventId}` },
            update: {
              $setOnInsert: {
                operation: "formation",
                evidenceIds: [item.eventId],
                memoryIds: [],
                status: "pending",
                attempts: 0,
                availableAt: new Date(),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      totals.scheduled += result.upsertedCount;
    }
    cursor = evidence.at(-1)?._id ?? null;
  }
  return totals;
}

function formationBatchKey(evidenceIds: string[]): string {
  return createHash("sha256")
    .update([...evidenceIds].sort().join("|"))
    .digest("hex");
}

async function compactPendingFormationJobs(batchSize: number) {
  const totals = { singletonJobs: 0, compactedJobs: 0, batchJobs: 0 };
  if (batchSize === 1) return totals;
  const singletonJobs = await AgentMemoryJob.find({
    operation: "formation",
    status: "pending",
    "evidenceIds.0": { $exists: true },
    "evidenceIds.1": { $exists: false },
    "memoryIds.0": { $exists: false },
  })
    .select("_id evidenceIds")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  totals.singletonJobs = singletonJobs.length;
  for (let index = 0; index < singletonJobs.length; index += batchSize) {
    const group = singletonJobs.slice(index, index + batchSize);
    if (group.length < 2) continue;
    const session = await mongoose.startSession();
    let compacted = 0;
    try {
      await session.withTransaction(async () => {
        const current = await AgentMemoryJob.find({
          _id: { $in: group.map((job) => job._id) },
          operation: "formation",
          status: "pending",
        })
          .select("_id evidenceIds")
          .session(session)
          .lean();
        if (current.length < 2) return;
        const evidenceIds = [
          ...new Set(current.flatMap((job) => job.evidenceIds)),
        ];
        const batch = await AgentMemoryJob.findOneAndUpdate(
          {
            idempotencyKey: `formation:migration-batch:${formationBatchKey(evidenceIds)}`,
          },
          {
            $setOnInsert: {
              operation: "formation",
              evidenceIds,
              memoryIds: [],
              status: "pending",
              attempts: 0,
              availableAt: new Date(),
              checkpoint: { migrationBatch: true },
            },
          },
          { upsert: true, returnDocument: "after", session },
        );
        const result = await AgentMemoryJob.updateMany(
          { _id: { $in: current.map((job) => job._id) }, status: "pending" },
          {
            $set: {
              status: "cancelled",
              completedAt: new Date(),
              checkpoint: { batchedInto: batch._id.toString() },
            },
          },
          { session },
        );
        compacted = result.modifiedCount;
      });
    } finally {
      await session.endSession();
    }
    totals.compactedJobs += compacted;
    if (compacted > 0) totals.batchJobs += 1;
  }
  return totals;
}

async function executeJob(job: IAgentMemoryJob) {
  if (job.operation === "backfill") return processBackfillJob(job);
  if (job.operation === "formation") return processFormationJob(job);
  if (job.operation === "embedding") return processEmbeddingJob(job);
  if (job.operation === "reflection") return processReflectionJob(job);
  throw new Error(`Unsupported migration operation: ${job.operation}`);
}

async function drainOperation(
  operation: MigrationOperation,
  budget: JobBudget,
) {
  const workerId = `migration:${operation}:${randomUUID()}`;
  const totals = { attempted: 0, completed: 0, failed: 0, requeued: 0 };
  while (budget.remaining > 0) {
    if (operation === "reflection") await scheduleNextReflectionJob();
    const job = await leaseNextMemoryJob({ workerId, operations: [operation] });
    if (!job) break;
    budget.remaining -= 1;
    budget.processed += 1;
    totals.attempted += 1;
    try {
      const result = await executeJob(job);
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
        totals.requeued += 1;
      } else {
        await completeMemoryJob(job._id.toString(), workerId);
        totals.completed += 1;
      }
    } catch (error) {
      await failMemoryJob({
        jobId: job._id.toString(),
        workerId,
        attempt: job.attempts,
        error,
      });
      totals.failed += 1;
      console.error(
        `[agent-memory:migrate] ${operation} job ${job._id.toString()} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    if (totals.attempted % PROGRESS_INTERVAL === 0) {
      console.log(
        `[agent-memory:migrate] ${operation} attempted=${totals.attempted} completed=${totals.completed} failed=${totals.failed}`,
      );
    }
  }
  console.log(`[agent-memory:migrate] ${operation}`, totals);
  return totals;
}

async function runMigration(options: MigrationOptions) {
  await connectDB();
  const before = await databaseSummary();
  console.log(
    JSON.stringify(
      {
        mode: options.execute ? "execute" : "dry-run",
        options: {
          ...options,
          maxJobs: Number.isFinite(options.maxJobs) ? options.maxJobs : null,
        },
        before,
      },
      null,
      2,
    ),
  );
  if (!options.execute) {
    console.log(
      "Dry-run only. Run `bun run agent-memory:migrate --execute` to perform the migration.",
    );
    return;
  }

  const settings = await getAgentMemorySettings();
  const requiredGates = [
    settings.releaseGates.evidenceLedger,
    settings.releaseGates.formation,
    settings.releaseGates.shadowRetrieval,
    settings.releaseGates.reflection,
  ];
  if (requiredGates.some((enabled) => !enabled)) {
    throw new Error(
      "Gates A, B, C and E must be enabled before full migration",
    );
  }

  const conversations = options.skipConversations
    ? null
    : await ingestHistoricalConversations();
  const backfill = await scheduleAgentMemoryBackfill({
    idempotencyNamespace: options.generation,
  });
  console.log("[agent-memory:migrate] canonical backfill", backfill);

  const budget: JobBudget = {
    remaining: options.maxJobs,
    processed: 0,
  };
  const phases: Partial<
    Record<MigrationOperation, Awaited<ReturnType<typeof drainOperation>>>
  > = {};
  phases.backfill = await drainOperation("backfill", budget);
  const formationRepair = await ensureFormationJobs();
  console.log("[agent-memory:migrate] formation job repair", formationRepair);
  const formationCompaction = await compactPendingFormationJobs(
    options.formationBatchSize,
  );
  console.log(
    "[agent-memory:migrate] formation job compaction",
    formationCompaction,
  );
  phases.formation = await drainOperation("formation", budget);
  phases.embedding = await drainOperation("embedding", budget);
  phases.reflection = await drainOperation("reflection", budget);

  const after = await databaseSummary();
  const failed = Object.values(phases).reduce(
    (total, phase) => total + (phase?.failed ?? 0),
    0,
  );
  const remainingJobs = Object.entries(after.jobs).reduce(
    (total, [key, count]) =>
      MIGRATION_OPERATIONS.some((operation) =>
        key.startsWith(`${operation}:`),
      ) &&
      ["pending", "retry", "leased"].some((status) =>
        key.endsWith(`:${status}`),
      )
        ? total + count
        : total,
    0,
  );
  const capped = budget.remaining === 0 && remainingJobs > 0;
  console.log(
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        conversations,
        backfill,
        formationRepair,
        formationCompaction,
        jobsProcessed: budget.processed,
        phases,
        capped,
        failed,
        remainingJobs,
        after,
      },
      null,
      2,
    ),
  );
  if (failed > 0 || remainingJobs > 0) process.exitCode = 2;
}

if (import.meta.main) {
  try {
    await runMigration(parseMigrationOptions(process.argv.slice(2)));
  } finally {
    await mongoose.disconnect();
  }
}
