import { randomUUID } from "node:crypto";
import type {
  CreateAgentGoal,
  CreateAgentProcedure,
  UpdateAgentGoal,
  UpdateAgentProcedure,
} from "@repo/schemas";
import mongoose, { type ClientSession, Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { AgentAuditEvent } from "@/models/AgentAuditEvent";
import { AgentEvidenceEvent } from "@/models/AgentEvidenceEvent";
import { AgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import { AgentGoal, type IAgentGoal } from "@/models/AgentGoal";
import { AgentProcedure, type IAgentProcedure } from "@/models/AgentProcedure";
import { AgentMemoryPolicyError } from "./policy";
import { scheduleLifecycleReflection } from "./reflection";
import {
  containsPermissionLikeInstruction,
  findDeniedContent,
} from "./security";

const MIN_PROCEDURE_SIGNALS = 3;
const MIN_PROCEDURE_SESSIONS = 2;

// Runs after the write transaction has already committed, so a failure here
// must not surface as a failed write (which would prompt unsafe client retries
// and duplicate creations). Log and swallow instead.
async function safeScheduleLifecycleReflection(
  ...args: Parameters<typeof scheduleLifecycleReflection>
): Promise<void> {
  try {
    await scheduleLifecycleReflection(...args);
  } catch (error) {
    console.error("Failed to schedule lifecycle reflection", ...args, error);
  }
}

async function audit(
  input: {
    action: string;
    targetType: string;
    targetId: string;
    targetRevision: number;
    reason: string;
    metadata?: Record<string, unknown>;
  },
  session: ClientSession,
) {
  await AgentAuditEvent.create(
    [
      {
        auditId: randomUUID(),
        ...input,
        actor: "user",
        metadata: input.metadata ?? {},
        contentRedacted: false,
        occurredAt: new Date(),
      },
    ],
    { session },
  );
}

function objectIds(ids: string[], field: string): Types.ObjectId[] {
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    throw new AgentMemoryPolicyError(`Invalid ${field}`, "invalid-provenance");
  }
  return ids.map((id) => new Types.ObjectId(id));
}

async function assertEvidence(eventIds: string[], session: ClientSession) {
  if (eventIds.length === 0) return;
  const unique = [...new Set(eventIds)];
  const count = await AgentEvidenceEvent.countDocuments({
    eventId: { $in: unique },
    memoryEligible: true,
    redactedAt: { $exists: false },
  }).session(session);
  if (count !== unique.length) {
    throw new AgentMemoryPolicyError(
      "Goal or procedure cites missing or redacted evidence",
      "invalid-provenance",
    );
  }
}

async function assertGoalsExist(goalIds: string[], session: ClientSession) {
  if (goalIds.length === 0) return;
  const ids = objectIds(goalIds, "goal dependency ID");
  const unique = [...new Map(ids.map((id) => [id.toString(), id])).values()];
  const count = await AgentGoal.countDocuments({
    _id: { $in: unique },
  }).session(session);
  if (count !== unique.length) {
    throw new AgentMemoryPolicyError(
      "Goal dependency references a missing goal",
      "invalid-provenance",
    );
  }
}

export function assertProcedureText(input: {
  scope: string;
  trigger: string;
  behavior: string;
  exceptions: string[];
}) {
  const text = [
    input.scope,
    input.trigger,
    input.behavior,
    ...input.exceptions,
  ].join("\n");
  if (findDeniedContent(text).length > 0) {
    throw new AgentMemoryPolicyError(
      "Procedure contains denied secret material",
      "denied-content",
    );
  }
  if (containsPermissionLikeInstruction(text)) {
    throw new AgentMemoryPolicyError(
      "Procedures cannot alter permissions, approvals, or system policy",
      "permission-like",
    );
  }
}

export function canActivateProcedure(input: {
  explicit: boolean;
  supportingSignals: number;
  supportingSessions: number;
  contradictorySignals: number;
}): { allowed: boolean; reason: string } {
  if (input.explicit) {
    return { allowed: true, reason: "Explicit owner-authored procedure" };
  }
  if (input.contradictorySignals > 0) {
    return {
      allowed: false,
      reason: "Contradictory feedback requires exception review",
    };
  }
  const allowed =
    input.supportingSignals >= MIN_PROCEDURE_SIGNALS &&
    input.supportingSessions >= MIN_PROCEDURE_SESSIONS;
  return {
    allowed,
    reason: allowed
      ? "Repeated feedback passed the procedure promotion threshold"
      : `Inferred procedures require ${MIN_PROCEDURE_SIGNALS} signals across ${MIN_PROCEDURE_SESSIONS} sessions`,
  };
}

async function procedureSignals(
  feedbackIds: Types.ObjectId[],
  session: ClientSession,
) {
  const feedback = await AgentFeedbackEvent.find({ _id: { $in: feedbackIds } })
    .select("kind conversationId")
    .session(session)
    .lean();
  const negativeKinds = new Set([
    "not-relevant",
    "tool-denied",
    "tool-failed",
    "tool-undone",
    "suggestion-dismissed",
  ]);
  return {
    supportingSignals: feedback.filter((item) => !negativeKinds.has(item.kind))
      .length,
    supportingSessions: new Set(
      feedback.flatMap((item) =>
        item.conversationId ? [item.conversationId.toString()] : [],
      ),
    ).size,
    contradictorySignals: feedback.filter((item) =>
      negativeKinds.has(item.kind),
    ).length,
  };
}

async function assertProcedureActivation(
  procedure: Pick<
    IAgentProcedure,
    "explicit" | "supportingFeedbackIds" | "lifecycle"
  >,
  requestedLifecycle: IAgentProcedure["lifecycle"],
  session: ClientSession,
) {
  if (requestedLifecycle !== "active") return;
  const decision = canActivateProcedure({
    explicit: procedure.explicit,
    ...(await procedureSignals(procedure.supportingFeedbackIds, session)),
  });
  if (!decision.allowed) {
    throw new AgentMemoryPolicyError(decision.reason, "unsafe-promotion");
  }
}

export async function createGoal(input: CreateAgentGoal): Promise<IAgentGoal> {
  if (
    input.kind === "agent-follow-up" &&
    !input.targetFrom &&
    !input.targetUntil
  ) {
    throw new AgentMemoryPolicyError(
      "Agent follow-up commitments require a concrete target date",
      "conflict",
    );
  }
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentGoal | null = null;
  try {
    await session.withTransaction(async () => {
      await assertEvidence(input.progressEvidenceIds, session);
      await assertGoalsExist(input.dependencyIds, session);
      const goalId = new Types.ObjectId();
      const goal = new AgentGoal({
        _id: goalId,
        ...input,
        dependencyIds: objectIds(input.dependencyIds, "goal dependency ID"),
        provenance: { entityType: "manual", entityId: goalId.toString() },
        revision: 1,
      });
      await goal.save({ session });
      await audit(
        {
          action: "goal.create",
          targetType: "goal",
          targetId: goalId.toString(),
          targetRevision: 1,
          reason: "Owner created goal",
        },
        session,
      );
      result = goal;
    });
  } finally {
    await session.endSession();
  }
  const completed = result as IAgentGoal | null;
  if (!completed) throw new Error("Goal creation did not complete");
  await safeScheduleLifecycleReflection(
    "goal",
    completed._id.toString(),
    completed.revision,
  );
  return completed;
}

export async function updateGoal(
  goalId: string,
  input: UpdateAgentGoal,
): Promise<IAgentGoal> {
  if (!mongoose.isValidObjectId(goalId)) {
    throw new AgentMemoryPolicyError("Goal not found", "not-found");
  }
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentGoal | null = null;
  try {
    await session.withTransaction(async () => {
      const goal = await AgentGoal.findById(goalId).session(session);
      if (!goal)
        throw new AgentMemoryPolicyError("Goal not found", "not-found");
      const { reason, dependencyIds, progressEvidenceIds, ...fields } = input;
      if (progressEvidenceIds)
        await assertEvidence(progressEvidenceIds, session);
      if (dependencyIds) await assertGoalsExist(dependencyIds, session);
      goal.set({
        ...fields,
        ...(dependencyIds
          ? { dependencyIds: objectIds(dependencyIds, "goal dependency ID") }
          : {}),
        ...(progressEvidenceIds ? { progressEvidenceIds } : {}),
        revision: goal.revision + 1,
      });
      await goal.save({ session });
      await audit(
        {
          action: "goal.update",
          targetType: "goal",
          targetId: goalId,
          targetRevision: goal.revision,
          reason,
        },
        session,
      );
      result = goal;
    });
  } finally {
    await session.endSession();
  }
  const completed = result as IAgentGoal | null;
  if (!completed) throw new Error("Goal update did not complete");
  await safeScheduleLifecycleReflection(
    "goal",
    completed._id.toString(),
    completed.revision,
  );
  return completed;
}

export async function createProcedure(
  input: CreateAgentProcedure,
): Promise<IAgentProcedure> {
  assertProcedureText(input);
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentProcedure | null = null;
  try {
    await session.withTransaction(async () => {
      await assertEvidence(input.evidenceIds, session);
      const supportingFeedbackIds = objectIds(
        input.supportingFeedbackIds,
        "supporting feedback ID",
      );
      const lifecycle =
        input.lifecycle ?? (input.explicit ? "active" : "candidate");
      await assertProcedureActivation(
        { explicit: input.explicit, supportingFeedbackIds, lifecycle },
        lifecycle,
        session,
      );
      const procedure = new AgentProcedure({
        ...input,
        lifecycle,
        supportingFeedbackIds,
        revision: 1,
        ...(lifecycle === "active"
          ? { promotionReason: "Passed procedure activation policy" }
          : {}),
      });
      await procedure.save({ session });
      await audit(
        {
          action: "procedure.create",
          targetType: "procedure",
          targetId: procedure._id.toString(),
          targetRevision: 1,
          reason: input.explicit
            ? "Owner created explicit procedure"
            : "Created learned procedure candidate",
          metadata: { lifecycle },
        },
        session,
      );
      result = procedure;
    });
  } finally {
    await session.endSession();
  }
  const completed = result as IAgentProcedure | null;
  if (!completed) throw new Error("Procedure creation did not complete");
  await safeScheduleLifecycleReflection(
    "procedure",
    completed._id.toString(),
    completed.revision,
  );
  return completed;
}

export async function updateProcedure(
  procedureId: string,
  input: UpdateAgentProcedure,
): Promise<IAgentProcedure> {
  if (!mongoose.isValidObjectId(procedureId)) {
    throw new AgentMemoryPolicyError("Procedure not found", "not-found");
  }
  await connectDB();
  const session = await mongoose.startSession();
  let result: IAgentProcedure | null = null;
  try {
    await session.withTransaction(async () => {
      const procedure =
        await AgentProcedure.findById(procedureId).session(session);
      if (!procedure) {
        throw new AgentMemoryPolicyError("Procedure not found", "not-found");
      }
      const { reason, supportingFeedbackIds, evidenceIds, ...fields } = input;
      const next = {
        scope: fields.scope ?? procedure.scope,
        trigger: fields.trigger ?? procedure.trigger,
        behavior: fields.behavior ?? procedure.behavior,
        exceptions: fields.exceptions ?? procedure.exceptions,
      };
      assertProcedureText(next);
      if (evidenceIds) await assertEvidence(evidenceIds, session);
      const nextFeedbackIds = supportingFeedbackIds
        ? objectIds(supportingFeedbackIds, "supporting feedback ID")
        : procedure.supportingFeedbackIds;
      const nextLifecycle = fields.lifecycle ?? procedure.lifecycle;
      await assertProcedureActivation(
        {
          explicit: fields.explicit ?? procedure.explicit,
          supportingFeedbackIds: nextFeedbackIds,
          lifecycle: procedure.lifecycle,
        },
        nextLifecycle,
        session,
      );
      procedure.set({
        ...fields,
        ...next,
        lifecycle: nextLifecycle,
        supportingFeedbackIds: nextFeedbackIds,
        ...(evidenceIds ? { evidenceIds } : {}),
        revision: procedure.revision + 1,
        ...(nextLifecycle === "active" && procedure.lifecycle !== "active"
          ? { promotionReason: reason, retirementReason: undefined }
          : {}),
        ...(nextLifecycle === "retired" ? { retirementReason: reason } : {}),
      });
      await procedure.save({ session });
      await audit(
        {
          action: "procedure.update",
          targetType: "procedure",
          targetId: procedureId,
          targetRevision: procedure.revision,
          reason,
          metadata: { lifecycle: nextLifecycle },
        },
        session,
      );
      result = procedure;
    });
  } finally {
    await session.endSession();
  }
  const completed = result as IAgentProcedure | null;
  if (!completed) throw new Error("Procedure update did not complete");
  await safeScheduleLifecycleReflection(
    "procedure",
    completed._id.toString(),
    completed.revision,
  );
  return completed;
}

export const AGENT_PROCEDURE_PROMOTION_POLICY = {
  minimumSignals: MIN_PROCEDURE_SIGNALS,
  minimumSessions: MIN_PROCEDURE_SESSIONS,
} as const;
