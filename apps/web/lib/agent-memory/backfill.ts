import type { Model } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentMemoryJob, type IAgentMemoryJob } from "@/models/AgentMemoryJob";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { EmailTriageModel } from "@/models/EmailTriage";
import { JournalLog } from "@/models/Journal";
import { Note } from "@/models/Note";
import { Person } from "@/models/Person";
import { Project } from "@/models/Project";
import {
  type AgentDomainKind,
  observeDomainRecordSafely,
} from "./domain-evidence";

const BACKFILL_BATCH_SIZE = 25;

export const AGENT_MEMORY_BACKFILL_DOMAINS = [
  "note",
  "calendar",
  "person",
  "project",
  "course",
  "journal",
  "email-triage",
] as const satisfies readonly AgentDomainKind[];

type BackfillDomain = (typeof AGENT_MEMORY_BACKFILL_DOMAINS)[number];

const DOMAIN_MODELS: Record<BackfillDomain, Model<unknown>> = {
  note: Note as unknown as Model<unknown>,
  calendar: CalendarEvent as unknown as Model<unknown>,
  person: Person as unknown as Model<unknown>,
  project: Project as unknown as Model<unknown>,
  course: Course as unknown as Model<unknown>,
  journal: JournalLog as unknown as Model<unknown>,
  "email-triage": EmailTriageModel as unknown as Model<unknown>,
};

function isBackfillDomain(value: unknown): value is BackfillDomain {
  return AGENT_MEMORY_BACKFILL_DOMAINS.some((domain) => domain === value);
}

export interface BackfillCheckpoint {
  domain: BackfillDomain;
  cursor?: string;
  processed: number;
}

export function parseBackfillCheckpoint(
  value: Record<string, unknown> | undefined,
): BackfillCheckpoint {
  if (!value || !isBackfillDomain(value.domain)) {
    throw new Error("Backfill job has an invalid domain checkpoint");
  }
  return {
    domain: value.domain,
    cursor: typeof value.cursor === "string" ? value.cursor : undefined,
    processed:
      typeof value.processed === "number" && value.processed >= 0
        ? Math.trunc(value.processed)
        : 0,
  };
}

export async function scheduleAgentMemoryBackfill(options?: {
  idempotencyNamespace?: string;
}): Promise<{
  scheduled: number;
}> {
  const namespace = options?.idempotencyNamespace ?? "v1";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(namespace)) {
    throw new Error("Backfill idempotency namespace is invalid");
  }
  await connectDB();
  let scheduled = 0;
  for (const domain of AGENT_MEMORY_BACKFILL_DOMAINS) {
    const result = await AgentMemoryJob.updateOne(
      { idempotencyKey: `backfill:${namespace}:${domain}` },
      {
        $setOnInsert: {
          operation: "backfill",
          evidenceIds: [],
          memoryIds: [],
          status: "pending",
          attempts: 0,
          availableAt: new Date(),
          checkpoint: { domain, processed: 0 },
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount === 1) scheduled += 1;
  }
  return { scheduled };
}

export async function processBackfillJob(job: IAgentMemoryJob): Promise<{
  done: boolean;
  processed: number;
  checkpoint: BackfillCheckpoint;
}> {
  const checkpoint = parseBackfillCheckpoint(job.checkpoint);
  const query = checkpoint.cursor ? { _id: { $gt: checkpoint.cursor } } : {};
  const rows = await DOMAIN_MODELS[checkpoint.domain]
    .find(query)
    .sort({ _id: 1 })
    .limit(BACKFILL_BATCH_SIZE)
    .lean();
  for (const row of rows) {
    await observeDomainRecordSafely(checkpoint.domain, row);
  }
  const cursor = rows.at(-1)?._id;
  const nextCheckpoint: BackfillCheckpoint = {
    domain: checkpoint.domain,
    cursor: cursor ? String(cursor) : checkpoint.cursor,
    processed: checkpoint.processed + rows.length,
  };
  return {
    done: rows.length < BACKFILL_BATCH_SIZE,
    processed: rows.length,
    checkpoint: nextCheckpoint,
  };
}

export const AGENT_MEMORY_BACKFILL_BATCH_SIZE = BACKFILL_BATCH_SIZE;
