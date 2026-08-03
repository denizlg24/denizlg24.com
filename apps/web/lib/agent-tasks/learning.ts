import { randomUUID } from "node:crypto";
import type { CreateAgentTaskFeedback } from "@repo/schemas";
import { Types } from "mongoose";
import {
  buildEvidenceInput,
  observeEvidence,
} from "@/lib/agent-memory/evidence";
import {
  keywordOverlap,
  keywordTerms,
} from "@/lib/agent-memory/lexical-overlap";
import { createProcedure, updateProcedure } from "@/lib/agent-memory/lifecycle";
import { connectDB } from "@/lib/mongodb";
import {
  AgentFeedbackEvent,
  type IAgentFeedbackEvent,
} from "@/models/AgentFeedbackEvent";
import { AgentProcedure, type IAgentProcedure } from "@/models/AgentProcedure";
import { AgentTask, type IAgentTask } from "@/models/AgentTask";
import { AgentTaskRun, type IAgentTaskRun } from "@/models/AgentTaskRun";
import {
  distillLessons,
  findNearDuplicate,
  type GeneralizedLesson,
  quoteAppearsIn,
  type RejectedLesson,
  verifyLessons,
} from "./lessons";
import { serializeAgentTaskRun } from "./serialize";

/**
 * Candidates are matched against the owner's words as well as the task prompt.
 * Ranking on the prompt alone was why updates so rarely landed on the right
 * procedure: the feedback is what the lesson is about, and the prompt only says
 * what the run was trying to do.
 */
async function relevantProcedures(prompt: string, feedback: string) {
  const queryTerms = keywordTerms(`${feedback} ${prompt}`);
  const procedures = await AgentProcedure.find({
    lifecycle: { $in: ["candidate", "testing", "active"] },
  })
    .sort({ confidence: -1, updatedAt: -1 })
    .limit(100);
  return procedures
    .map((procedure) => ({
      procedure,
      score: keywordOverlap(
        queryTerms,
        `${procedure.scope} ${procedure.trigger} ${procedure.behavior}`,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(({ procedure }) => procedure);
}

export interface FeedbackDependencies {
  connect(): Promise<unknown>;
  findDuplicate(feedbackId: string): Promise<IAgentTaskRun | null>;
  claimRun(
    runId: string,
    feedback: IAgentTaskRun["feedback"],
  ): Promise<IAgentTaskRun | null>;
  findRun(runId: string): Promise<IAgentTaskRun | null>;
  findTask(taskId: Types.ObjectId): Promise<IAgentTask | null>;
  observe: typeof observeEvidence;
  createFeedbackEvent(
    input: Record<string, unknown>,
  ): Promise<IAgentFeedbackEvent>;
  findRelevant(prompt: string, feedback: string): Promise<IAgentProcedure[]>;
  findProcedures(ids: Types.ObjectId[]): Promise<IAgentProcedure[]>;
  distill: typeof distillLessons;
  verify: typeof verifyLessons;
  createProcedure(
    input: Parameters<typeof createProcedure>[0],
  ): Promise<IAgentProcedure>;
  updateProcedure(
    procedureId: string,
    input: Parameters<typeof updateProcedure>[1],
  ): Promise<IAgentProcedure>;
  now(): Date;
}

const defaultFeedbackDependencies: FeedbackDependencies = {
  connect: async () => connectDB(),
  findDuplicate: async (feedbackId) =>
    AgentTaskRun.findOne({ "feedback.feedbackId": feedbackId }),
  // Feedback attaches to a run that has already finished, so this never gates
  // the run itself. Writing the verdict as part of the claim is what makes it a
  // claim at all: distillation takes seconds, and a check that reserved nothing
  // would let a second submission slip in behind the first.
  claimRun: async (runId, feedback) =>
    AgentTaskRun.findOneAndUpdate(
      {
        _id: runId,
        status: { $in: ["completed", "failed"] },
        feedback: { $exists: false },
      },
      { $set: { feedback } },
      { returnDocument: "after" },
    ),
  findRun: async (runId) => AgentTaskRun.findById(runId),
  findTask: async (taskId) => AgentTask.findById(taskId),
  observe: observeEvidence,
  createFeedbackEvent: async (input) => AgentFeedbackEvent.create(input),
  findRelevant: relevantProcedures,
  findProcedures: async (ids) => AgentProcedure.find({ _id: { $in: ids } }),
  distill: distillLessons,
  verify: verifyLessons,
  createProcedure,
  updateProcedure,
  now: () => new Date(),
};

export interface LearnedProcedure {
  id: string;
  action: "created" | "updated" | "retired";
  scope: string;
  behavior: string;
}

/**
 * Two filters stand between a proposed lesson and the procedure store: the
 * quote it claims to be based on must actually appear in the owner's feedback,
 * and a second model that never saw the extraction must independently agree the
 * lesson is grounded and reusable. Both rejections are reported rather than
 * swallowed, so a run that teaches nothing says so instead of looking broken.
 */
function screenLessons(options: {
  lessons: GeneralizedLesson[];
  feedback: string;
  existingById: Map<string, IAgentProcedure>;
}) {
  const kept: GeneralizedLesson[] = [];
  const rejected: RejectedLesson[] = [];
  for (const lesson of options.lessons) {
    if (lesson.action === "none") continue;

    if (!lesson.evidenceQuote) {
      rejected.push({ reason: "No quote from your feedback was supplied." });
      continue;
    }
    if (!quoteAppearsIn(lesson.evidenceQuote, options.feedback)) {
      rejected.push({
        reason: `Quoted "${lesson.evidenceQuote.slice(0, 120)}", which you never wrote.`,
      });
      continue;
    }
    if (lesson.action === "retire" || lesson.action === "update") {
      if (!lesson.targetId || !options.existingById.has(lesson.targetId)) {
        rejected.push({
          reason: `Targeted a procedure that does not exist (${lesson.action}).`,
        });
        continue;
      }
    }
    if (
      lesson.action !== "retire" &&
      (!lesson.scope || !lesson.trigger || !lesson.behavior)
    ) {
      rejected.push({
        reason: "Incomplete procedure: missing scope, trigger or behavior.",
      });
      continue;
    }
    kept.push(lesson);
  }
  return { kept, rejected };
}

export async function recordAgentTaskFeedback(
  runId: string,
  input: CreateAgentTaskFeedback,
  overrides: Partial<FeedbackDependencies> = {},
) {
  const dependencies = { ...defaultFeedbackDependencies, ...overrides };
  await dependencies.connect();
  const duplicate = await dependencies.findDuplicate(input.feedbackId);
  if (duplicate) {
    // A client retrying after a timeout gets the original answer, not an empty
    // one — the run already records which procedures the first call produced.
    const learnedIds = duplicate.feedback?.learnedProcedureIds ?? [];
    const learned =
      learnedIds.length > 0
        ? await dependencies.findProcedures(learnedIds)
        : [];
    return {
      run: serializeAgentTaskRun(duplicate),
      learnedProcedures: learned.map((procedure) => ({
        id: procedure._id.toString(),
        action: "created" as const,
        scope: procedure.scope,
        behavior: procedure.behavior,
      })),
      rejected: [],
    };
  }

  const feedbackText = input.text ?? "";
  const occurredAt = dependencies.now();
  const run = Types.ObjectId.isValid(runId)
    ? await dependencies.claimRun(runId, {
        feedbackId: input.feedbackId,
        verdict: input.verdict,
        text: input.text,
        learnedProcedureIds: [],
        createdAt: occurredAt,
      })
    : null;
  if (!run) {
    const existing = Types.ObjectId.isValid(runId)
      ? await dependencies.findRun(runId)
      : null;
    if (!existing) throw new Error("Run not found");
    if (existing.feedback) throw new Error("Run already has feedback");
    throw new Error("Run has not finished yet");
  }

  const task = await dependencies.findTask(run.taskId);
  if (!task) throw new Error("Task not found");

  const evidence = await dependencies.observe({
    memoryMode: "enabled",
    enqueueFormation: false,
    evidence: buildEvidenceInput({
      idempotencyKey: `agent-task-feedback:${input.feedbackId}`,
      sourceType: "feedback",
      sourceRef: { entityType: "agent-task-run", entityId: runId },
      sourceRevision: run.updatedAt.toISOString(),
      content: {
        verdict: input.verdict,
        text: feedbackText,
        taskPrompt: task.prompt,
        output: run.output,
      },
      snapshot: [
        `Task: ${task.prompt}`,
        `Output: ${run.output ?? ""}`,
        `Verdict: ${input.verdict}`,
        `Feedback: ${feedbackText}`,
      ].join("\n\n"),
      occurredAt,
      actor: "user",
      trust: "highest",
      sensitivity: "personal",
      provenance: {
        agentTaskId: task._id.toString(),
        agentTaskRunId: runId,
      },
    }),
  });
  const evidenceIds = evidence.eventId ? [evidence.eventId] : [];
  const feedbackEvent = await dependencies.createFeedbackEvent({
    eventId: randomUUID(),
    idempotencyKey: `agent-task-feedback:${input.feedbackId}`,
    kind: input.verdict === "useful" ? "useful" : "correction",
    memoryIds: [],
    evidenceIds,
    boundedDiff: {
      agentTaskId: task._id.toString(),
      agentTaskRunId: runId,
      feedbackId: input.feedbackId,
      verdict: input.verdict,
      feedback: feedbackText.slice(0, 16_000),
    },
  });

  const learnedProcedures: LearnedProcedure[] = [];
  const rejected: RejectedLesson[] = [];
  try {
    const existing = await dependencies.findRelevant(task.prompt, feedbackText);
    const existingById = new Map(
      existing.map((procedure) => [procedure._id.toString(), procedure]),
    );
    const lessons = await dependencies.distill({
      prompt: task.prompt,
      output: run.output ?? "",
      verdict: input.verdict,
      feedback: feedbackText,
      existing,
    });

    const screened = screenLessons({
      lessons,
      feedback: feedbackText,
      existingById,
    });
    rejected.push(...screened.rejected);

    const verdicts = await dependencies.verify({
      feedback: feedbackText,
      verdict: input.verdict,
      candidates: screened.kept,
    });

    for (const [index, lesson] of screened.kept.entries()) {
      const verdict = verdicts.get(index);
      // Absent verdict means the checker did not rule on it. Silence is not
      // approval for something that writes to the procedure store.
      if (!verdict?.keep) {
        rejected.push({
          reason: verdict?.reason ?? "The grounding check did not confirm it.",
        });
        continue;
      }

      if (lesson.action === "retire") {
        const target = existingById.get(lesson.targetId as string);
        if (!target) continue;
        const procedure = await dependencies.updateProcedure(
          lesson.targetId as string,
          {
            lifecycle: "retired",
            supportingFeedbackIds: [
              ...target.supportingFeedbackIds.map(String),
              feedbackEvent._id.toString(),
            ],
            evidenceIds: [...new Set([...target.evidenceIds, ...evidenceIds])],
            reason: lesson.reason,
          },
        );
        learnedProcedures.push({
          id: procedure._id.toString(),
          action: "retired",
          scope: procedure.scope,
          behavior: procedure.behavior,
        });
        continue;
      }

      // A create that restates a procedure already on file becomes an update to
      // it, so repeated feedback sharpens one rule instead of spawning a fifth
      // copy that competes with it at retrieval time.
      const duplicateOf =
        lesson.action === "create" ? findNearDuplicate(lesson, existing) : null;
      const targetId = duplicateOf?._id.toString() ?? lesson.targetId;
      const current = targetId ? existingById.get(targetId) : undefined;

      if (targetId && current) {
        const procedure = await dependencies.updateProcedure(targetId, {
          scope: lesson.scope as string,
          trigger: lesson.trigger as string,
          behavior: lesson.behavior as string,
          exceptions: lesson.exceptions,
          confidence: lesson.confidence,
          explicit: true,
          lifecycle: "active",
          supportingFeedbackIds: [
            ...new Set([
              ...current.supportingFeedbackIds.map(String),
              feedbackEvent._id.toString(),
            ]),
          ],
          evidenceIds: [...new Set([...current.evidenceIds, ...evidenceIds])],
          reason: lesson.reason,
        });
        learnedProcedures.push({
          id: procedure._id.toString(),
          action: "updated",
          scope: procedure.scope,
          behavior: procedure.behavior,
        });
        continue;
      }

      const procedure = await dependencies.createProcedure({
        scope: lesson.scope as string,
        trigger: lesson.trigger as string,
        behavior: lesson.behavior as string,
        exceptions: lesson.exceptions,
        confidence: lesson.confidence,
        explicit: true,
        lifecycle: "active",
        supportingFeedbackIds: [feedbackEvent._id.toString()],
        evidenceIds,
      });
      learnedProcedures.push({
        id: procedure._id.toString(),
        action: "created",
        scope: procedure.scope,
        behavior: procedure.behavior,
      });
    }
  } catch (error) {
    console.error("[Agent Tasks] Feedback learning failed", error);
    rejected.push({
      reason: `Learning failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`.slice(0, 500),
    });
  }

  // The verdict itself landed with the claim; only the procedures it produced
  // are still outstanding, so a crash in distillation loses the lesson but
  // never the feedback.
  if (run.feedback) {
    run.feedback.learnedProcedureIds = learnedProcedures.map(
      (procedure) => new Types.ObjectId(procedure.id),
    );
    await run.save();
  }
  return { run: serializeAgentTaskRun(run), learnedProcedures, rejected };
}
