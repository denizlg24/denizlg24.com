import {
  type DomainEventRecord,
  domainEventTypeSchema,
  type TriggerInput,
  type TriggerPatch,
  triggerActionSchema,
  triggerFilterSchema,
  triggerInputSchema,
  type WorkspaceTrigger,
} from "@repo/schemas";
import { Types } from "mongoose";
import { nextCronOccurrence } from "@/lib/agent-tasks/cron";
import { connectDB } from "@/lib/mongodb";
import { WorkspaceError } from "@/lib/workspace/service";
import {
  DomainEventModel,
  type IDomainEvent,
  type IWorkspaceTrigger,
  WorkspaceTriggerModel,
} from "@/models/DomainEvent";

/** A stored trigger, re-validated; null when it no longer reads as one. */
export function triggerFromDoc(
  doc: IWorkspaceTrigger,
): WorkspaceTrigger | null {
  const event = domainEventTypeSchema.safeParse(doc.event);
  const filter = triggerFilterSchema.safeParse(doc.filter);
  const action = triggerActionSchema.safeParse(doc.action);
  if (!event.success || !filter.success || !action.success) return null;
  return {
    id: doc._id.toString(),
    name: doc.name,
    enabled: doc.enabled,
    event: event.data,
    filter: filter.data,
    schedule: doc.schedule,
    action: action.data,
    maxPerHour: doc.maxPerHour,
    consecutiveFailures: doc.consecutiveFailures,
    disabledReason: doc.disabledReason,
    lastFiredAt: doc.lastFiredAt ? doc.lastFiredAt.toISOString() : null,
    lastResult: doc.lastResult,
    nextRunAt: doc.nextRunAt ? doc.nextRunAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function eventRecordOf(doc: IDomainEvent): DomainEventRecord {
  return {
    id: doc._id.toString(),
    type: doc.type,
    payload: doc.payload,
    at: doc.at.toISOString(),
    depth: doc.depth,
    triggerIds: doc.triggerIds,
    firings: doc.firings,
  };
}

function nextTick(
  schedule: { cron: string; timeZone: string } | null,
  enabled: boolean,
): Date | null {
  if (!schedule || !enabled) return null;
  try {
    return nextCronOccurrence({
      cron: schedule.cron,
      timeZone: schedule.timeZone,
    });
  } catch (error) {
    throw new WorkspaceError(
      400,
      "INVALID_SCHEDULE",
      error instanceof Error ? error.message : "Invalid schedule",
    );
  }
}

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new WorkspaceError(404, "NOT_FOUND", `No trigger ${id}`);
  }
  return new Types.ObjectId(id);
}

function serialized(
  doc: IWorkspaceTrigger | null,
  id: string,
): WorkspaceTrigger {
  const trigger = doc ? triggerFromDoc(doc) : null;
  if (!trigger) throw new WorkspaceError(404, "NOT_FOUND", `No trigger ${id}`);
  return trigger;
}

export async function listTriggers(): Promise<WorkspaceTrigger[]> {
  await connectDB();
  const docs = await WorkspaceTriggerModel.find()
    .sort({ createdAt: 1 })
    .lean<IWorkspaceTrigger[]>();
  return docs.flatMap((doc) => {
    const trigger = triggerFromDoc(doc);
    return trigger ? [trigger] : [];
  });
}

export async function createTrigger(
  input: TriggerInput,
): Promise<WorkspaceTrigger> {
  const parsed = triggerInputSchema.parse(input);
  await connectDB();
  const doc = await WorkspaceTriggerModel.create({
    ...parsed,
    nextRunAt: nextTick(parsed.schedule, parsed.enabled),
  });
  return serialized(doc.toObject(), doc._id.toString());
}

/**
 * Merges `patch` and re-checks the whole trigger. Turning a trigger back on
 * clears its failure count, so one auto-disabled after five failures gets
 * five more chances.
 */
export async function updateTrigger(
  id: string,
  patch: TriggerPatch,
): Promise<WorkspaceTrigger> {
  await connectDB();
  const current = serialized(
    await WorkspaceTriggerModel.findById(
      objectId(id),
    ).lean<IWorkspaceTrigger>(),
    id,
  );
  const parsed = triggerInputSchema.safeParse({
    name: current.name,
    enabled: current.enabled,
    event: current.event,
    filter: current.filter,
    schedule: current.schedule,
    action: current.action,
    maxPerHour: current.maxPerHour,
    ...patch,
  });
  if (!parsed.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid trigger", {
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  const next = parsed.data;
  const reenabled = next.enabled && !current.enabled;
  const doc = await WorkspaceTriggerModel.findByIdAndUpdate(
    objectId(id),
    {
      $set: {
        ...next,
        nextRunAt: nextTick(next.schedule, next.enabled),
        ...(reenabled ? { consecutiveFailures: 0, disabledReason: null } : {}),
      },
    },
    { returnDocument: "after" },
  ).lean<IWorkspaceTrigger>();
  return serialized(doc, id);
}

export async function deleteTrigger(id: string): Promise<void> {
  await connectDB();
  const deleted = await WorkspaceTriggerModel.findByIdAndDelete(objectId(id));
  if (!deleted) throw new WorkspaceError(404, "NOT_FOUND", `No trigger ${id}`);
}

export const EVENTS_LIST_MAX = 100;

/** Recent events, newest first; those a trigger saw when `triggerId` is given. */
export async function recentEvents(options: {
  limit: number;
  triggerId?: string;
}): Promise<DomainEventRecord[]> {
  await connectDB();
  const docs = await DomainEventModel.find(
    options.triggerId ? { "firings.triggerId": options.triggerId } : {},
  )
    .sort({ at: -1 })
    .limit(Math.min(options.limit, EVENTS_LIST_MAX))
    .lean<IDomainEvent[]>();
  return docs.map(eventRecordOf);
}
