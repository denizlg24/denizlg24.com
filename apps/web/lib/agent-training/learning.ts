import { randomUUID } from "node:crypto";
import type { CreateAgentTrainingFeedback } from "@repo/schemas";
import { Types } from "mongoose";
import { z } from "zod";
import {
  buildEvidenceInput,
  observeEvidence,
} from "@/lib/agent-memory/evidence";
import {
  keywordOverlap,
  keywordTerms,
} from "@/lib/agent-memory/lexical-overlap";
import { createProcedure, updateProcedure } from "@/lib/agent-memory/lifecycle";
import { generateToolResult, getUnattendedModel } from "@/lib/llm-service";
import { connectDB } from "@/lib/mongodb";
import {
  AgentFeedbackEvent,
  type IAgentFeedbackEvent,
} from "@/models/AgentFeedbackEvent";
import { AgentProcedure, type IAgentProcedure } from "@/models/AgentProcedure";
import {
  AgentTrainingRun,
  type IAgentTrainingRun,
} from "@/models/AgentTrainingRun";
import {
  AgentTrainingTask,
  type IAgentTrainingTask,
} from "@/models/AgentTrainingTask";
import { serializeTrainingRun } from "./serialize";

const MAX_LEARNING_CONTEXT_CHARS = 4_096;

const lessonSchema = z.object({
  action: z.enum(["create", "update", "retire", "none"]),
  targetId: z.string().optional(),
  scope: z.string().trim().min(1).max(1_000).optional(),
  trigger: z.string().trim().min(1).max(2_000).optional(),
  behavior: z.string().trim().min(1).max(4_096).optional(),
  exceptions: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
  reason: z.string().trim().min(1).max(2_000),
});

const lessonResultSchema = z.object({ lessons: z.array(lessonSchema).max(3) });
export type GeneralizedLesson = z.infer<typeof lessonSchema>;

const LESSON_TOOL = {
  name: "return_generalized_lessons",
  description:
    "Return reusable procedural lessons grounded in the owner's feedback.",
  input_schema: {
    type: "object" as const,
    properties: {
      lessons: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create", "update", "retire", "none"],
            },
            targetId: { type: "string" },
            scope: { type: "string", maxLength: 1_000 },
            trigger: { type: "string", maxLength: 2_000 },
            behavior: { type: "string", maxLength: 4_096 },
            exceptions: {
              type: "array",
              maxItems: 50,
              items: { type: "string", maxLength: 1_000 },
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string", maxLength: 2_000 },
          },
          required: ["action", "exceptions", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["lessons"],
    additionalProperties: false,
  },
};

async function relevantProcedures(prompt: string) {
  const queryTerms = keywordTerms(prompt);
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

async function distillLessons(options: {
  prompt: string;
  output: string;
  verdict: "useful" | "correction";
  feedback?: string;
  existing: IAgentProcedure[];
}) {
  const existing = options.existing.map((procedure) => ({
    id: procedure._id.toString(),
    scope: procedure.scope,
    trigger: procedure.trigger,
    behavior: procedure.behavior,
    exceptions: procedure.exceptions,
  }));
  const result = await generateToolResult({
    purpose: "agent-training-learning",
    source: "agent-training-feedback",
    model: getUnattendedModel(),
    system: `Distill explicit owner feedback into globally reusable working procedures.
Generalize beyond the exact task, while staying specific enough to retrieve for genuinely similar work.
Capture method, quality bar, format, decision rule, or exception—not facts unique to this one output.
Update an existing procedure when it represents the same lesson. Retire one only when the feedback directly contradicts it.
Never create permissions, approval bypasses, tool authority, or system policy. Return no lesson when the feedback has no reusable signal.`,
    prompt: JSON.stringify({
      taskPrompt: options.prompt.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      agentOutput: options.output.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      verdict: options.verdict,
      ownerFeedback: options.feedback ?? null,
      existingProcedures: existing,
    }),
    logUserPrompt: JSON.stringify({
      verdict: options.verdict,
      ownerFeedbackProvided: Boolean(options.feedback),
      existingProcedureCount: existing.length,
    }),
    tool: LESSON_TOOL,
    maxTokens: 4_096,
    temperature: 0,
  });
  return lessonResultSchema.parse(result.input).lessons;
}

export interface FeedbackDependencies {
  connect(): Promise<unknown>;
  findDuplicate(feedbackId: string): Promise<IAgentTrainingRun | null>;
  claimRun(runId: string): Promise<IAgentTrainingRun | null>;
  findRun(runId: string): Promise<IAgentTrainingRun | null>;
  restoreRun(runId: string): Promise<void>;
  findTask(taskId: Types.ObjectId): Promise<IAgentTrainingTask | null>;
  observe: typeof observeEvidence;
  createFeedbackEvent(
    input: Record<string, unknown>,
  ): Promise<IAgentFeedbackEvent>;
  findRelevant(prompt: string): Promise<IAgentProcedure[]>;
  distill: typeof distillLessons;
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
    AgentTrainingRun.findOne({ "feedback.feedbackId": feedbackId }),
  claimRun: async (runId) =>
    AgentTrainingRun.findOneAndUpdate(
      { _id: runId, status: "awaiting-feedback" },
      { $set: { status: "learning" }, $unset: { error: 1 } },
      { returnDocument: "after" },
    ),
  findRun: async (runId) => AgentTrainingRun.findById(runId),
  restoreRun: async (runId) => {
    await AgentTrainingRun.updateOne(
      { _id: runId, status: "learning", feedback: { $exists: false } },
      { $set: { status: "awaiting-feedback" } },
    );
  },
  findTask: async (taskId) => AgentTrainingTask.findById(taskId),
  observe: observeEvidence,
  createFeedbackEvent: async (input) => AgentFeedbackEvent.create(input),
  findRelevant: relevantProcedures,
  distill: distillLessons,
  createProcedure,
  updateProcedure,
  now: () => new Date(),
};

export async function recordTrainingFeedback(
  runId: string,
  input: CreateAgentTrainingFeedback,
  overrides: Partial<FeedbackDependencies> = {},
) {
  const dependencies = { ...defaultFeedbackDependencies, ...overrides };
  await dependencies.connect();
  const duplicate = await dependencies.findDuplicate(input.feedbackId);
  if (duplicate) {
    return { run: serializeTrainingRun(duplicate), learnedProcedures: [] };
  }

  const run = Types.ObjectId.isValid(runId)
    ? await dependencies.claimRun(runId)
    : null;
  if (!run) {
    const existing = Types.ObjectId.isValid(runId)
      ? await dependencies.findRun(runId)
      : null;
    if (!existing) throw new Error("Training run not found");
    throw new Error("Training run is not awaiting feedback");
  }

  const occurredAt = dependencies.now();
  let task: IAgentTrainingTask;
  let evidenceIds: string[];
  let feedbackEvent: IAgentFeedbackEvent;
  try {
    const foundTask = await dependencies.findTask(run.taskId);
    if (!foundTask) throw new Error("Training task not found");
    task = foundTask;
    const evidence = await dependencies.observe({
      memoryMode: "enabled",
      enqueueFormation: false,
      evidence: buildEvidenceInput({
        idempotencyKey: `training-feedback:${input.feedbackId}`,
        sourceType: "feedback",
        sourceRef: { entityType: "agent-training-run", entityId: runId },
        sourceRevision: run.updatedAt.toISOString(),
        content: {
          verdict: input.verdict,
          text: input.text,
          taskPrompt: task.prompt,
          output: run.output,
        },
        snapshot: [
          `Task: ${task.prompt}`,
          `Output: ${run.output ?? ""}`,
          `Verdict: ${input.verdict}`,
          `Feedback: ${input.text ?? ""}`,
        ].join("\n\n"),
        occurredAt,
        actor: "user",
        trust: "highest",
        sensitivity: "personal",
        provenance: {
          trainingTaskId: task._id.toString(),
          trainingRunId: runId,
        },
      }),
    });
    evidenceIds = evidence.eventId ? [evidence.eventId] : [];
    feedbackEvent = await dependencies.createFeedbackEvent({
      eventId: randomUUID(),
      idempotencyKey: `training-feedback:${input.feedbackId}`,
      kind: input.verdict === "useful" ? "useful" : "correction",
      memoryIds: [],
      evidenceIds,
      boundedDiff: {
        trainingTaskId: task._id.toString(),
        trainingRunId: runId,
        feedbackId: input.feedbackId,
        verdict: input.verdict,
        ...(input.text ? { feedback: input.text.slice(0, 16_000) } : {}),
      },
    });
  } catch (error) {
    console.error("[Agent Training] Feedback preparation failed", error);
    try {
      await dependencies.restoreRun(runId);
    } catch (restoreError) {
      console.error(
        "[Agent Training] Feedback claim restore failed",
        restoreError,
      );
    }
    throw error;
  }

  const learnedProcedures: Array<{
    id: string;
    action: "created" | "updated" | "retired";
  }> = [];
  try {
    const existing = await dependencies.findRelevant(task.prompt);
    const existingById = new Map(
      existing.map((procedure) => [procedure._id.toString(), procedure]),
    );
    const lessons = await dependencies.distill({
      prompt: task.prompt,
      output: run.output ?? "",
      verdict: input.verdict,
      feedback: input.text,
      existing,
    });
    for (const lesson of lessons) {
      if (lesson.action === "none") continue;
      if (lesson.action === "retire") {
        if (!lesson.targetId || !existingById.has(lesson.targetId)) continue;
        const procedure = await dependencies.updateProcedure(lesson.targetId, {
          lifecycle: "retired",
          supportingFeedbackIds: [
            ...(existingById
              .get(lesson.targetId)
              ?.supportingFeedbackIds.map(String) ?? []),
            feedbackEvent._id.toString(),
          ],
          evidenceIds: [
            ...new Set([
              ...(existingById.get(lesson.targetId)?.evidenceIds ?? []),
              ...evidenceIds,
            ]),
          ],
          reason: lesson.reason,
        });
        learnedProcedures.push({
          id: procedure._id.toString(),
          action: "retired",
        });
        continue;
      }
      if (!lesson.scope || !lesson.trigger || !lesson.behavior) continue;
      if (lesson.action === "update") {
        if (!lesson.targetId || !existingById.has(lesson.targetId)) continue;
        const current = existingById.get(lesson.targetId);
        if (!current) continue;
        const procedure = await dependencies.updateProcedure(lesson.targetId, {
          scope: lesson.scope,
          trigger: lesson.trigger,
          behavior: lesson.behavior,
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
        });
      } else {
        const procedure = await dependencies.createProcedure({
          scope: lesson.scope,
          trigger: lesson.trigger,
          behavior: lesson.behavior,
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
        });
      }
    }
    run.status = "completed";
  } catch (error) {
    console.error("[Agent Training] Feedback learning failed", error);
    run.status = "completed";
    run.error = `Feedback saved; learning failed: ${
      error instanceof Error ? error.message : "unknown error"
    }`.slice(0, 4_096);
  }
  run.feedback = {
    feedbackId: input.feedbackId,
    verdict: input.verdict,
    text: input.text,
    learnedProcedureIds: learnedProcedures.map(
      (procedure) => new Types.ObjectId(procedure.id),
    ),
    createdAt: occurredAt,
  };
  await run.save();
  return { run: serializeTrainingRun(run), learnedProcedures };
}
