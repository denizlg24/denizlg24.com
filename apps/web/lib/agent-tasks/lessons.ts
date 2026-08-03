import { z } from "zod";
import {
  keywordOverlap,
  keywordTerms,
} from "@/lib/agent-memory/lexical-overlap";
import { generateToolResult, getUnattendedModel } from "@/lib/llm-service";
import type { IAgentProcedure } from "@/models/AgentProcedure";

export const MAX_LEARNING_CONTEXT_CHARS = 4_096;

/**
 * Every lesson has to carry a verbatim span of the owner's own words. That one
 * field is what makes extraction checkable: a quote either appears in the
 * feedback or it does not, so an invented lesson is caught by string matching
 * rather than by trusting the model's judgement about its own output.
 */
export const lessonSchema = z.object({
  action: z.enum(["create", "update", "retire", "none"]),
  targetId: z.string().optional(),
  scope: z.string().trim().min(1).max(1_000).optional(),
  trigger: z.string().trim().min(1).max(2_000).optional(),
  behavior: z.string().trim().min(1).max(4_096).optional(),
  exceptions: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
  evidenceQuote: z.string().trim().min(1).max(1_000).optional(),
  reason: z.string().trim().min(1).max(2_000),
});
export type GeneralizedLesson = z.infer<typeof lessonSchema>;

export const lessonResultSchema = z.object({
  lessons: z.array(lessonSchema).max(3),
});

export interface RejectedLesson {
  reason: string;
}

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
            targetId: {
              type: "string",
              description:
                "Required for update and retire: the id of an existing procedure from the supplied list.",
            },
            scope: {
              type: "string",
              maxLength: 1_000,
              description:
                "The class of work this applies to, e.g. 'drafting project updates'. Not this one task.",
            },
            trigger: {
              type: "string",
              maxLength: 2_000,
              description: "The condition under which the behavior applies.",
            },
            behavior: {
              type: "string",
              maxLength: 4_096,
              description: "What to do, stated as an instruction.",
            },
            exceptions: {
              type: "array",
              maxItems: 50,
              items: { type: "string", maxLength: 1_000 },
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidenceQuote: {
              type: "string",
              maxLength: 1_000,
              description:
                "A span copied verbatim from ownerFeedback that states this lesson. Copy the characters exactly; do not paraphrase, translate or summarise. Required unless action is none.",
            },
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

const VERDICT_TOOL = {
  name: "return_grounding_verdicts",
  description: "Judge whether each candidate lesson is supported and reusable.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "number",
              description: "Zero-based index of the candidate being judged.",
            },
            keep: { type: "boolean" },
            reason: { type: "string", maxLength: 500 },
          },
          required: ["index", "keep", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  },
};

const verdictResultSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      keep: z.boolean(),
      reason: z.string().trim().min(1).max(500),
    }),
  ),
});

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Exact-substring matching is too brittle — models normalise curly quotes,
 * collapse whitespace and drop trailing punctuation while otherwise copying
 * faithfully. Comparing on alphanumerics only accepts those, and still rejects
 * a quote whose words were never written.
 */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return false;
  return normalizeForMatch(source).includes(needle);
}

/**
 * Two procedures whose scope and behavior share most of their vocabulary are
 * the same rule written twice. Left alone the store accumulates near-duplicates
 * that all match the same retrieval query and crowd out everything else.
 */
export function findNearDuplicate(
  lesson: GeneralizedLesson,
  existing: IAgentProcedure[],
): IAgentProcedure | null {
  const candidateText = `${lesson.scope ?? ""} ${lesson.behavior ?? ""}`;
  const terms = keywordTerms(candidateText);
  if (terms.size === 0) return null;
  for (const procedure of existing) {
    const overlap = keywordOverlap(
      terms,
      `${procedure.scope} ${procedure.behavior}`,
    );
    if (overlap / terms.size >= 0.6) return procedure;
  }
  return null;
}

export async function distillLessons(options: {
  prompt: string;
  output: string;
  verdict: "useful" | "correction";
  feedback: string;
  existing: IAgentProcedure[];
}): Promise<GeneralizedLesson[]> {
  const existing = options.existing.map((procedure) => ({
    id: procedure._id.toString(),
    scope: procedure.scope,
    trigger: procedure.trigger,
    behavior: procedure.behavior,
    exceptions: procedure.exceptions,
  }));
  const result = await generateToolResult({
    purpose: "agent-task-learning",
    source: "agent-task-feedback",
    model: await getUnattendedModel(),
    system: `Distill explicit owner feedback into globally reusable working procedures.

A procedure is worth writing only if it would change how a future, different task is carried out. Capture method, quality bar, format, decision rule or exception.

Do not write a procedure for:
- a fact about this one output, this one record, or this one day
- something the agent already did correctly and was merely thanked for
- a restatement of the task prompt
- anything the feedback does not actually say

Every lesson must quote the owner verbatim in evidenceQuote, copied character for character from ownerFeedback. If you cannot quote it, the feedback does not support it — return no lesson.

Prefer updating an existing procedure when it expresses the same rule. Retire one only when the feedback directly contradicts it. Never create permissions, approval bypasses, tool authority or system policy.

Returning an empty list is the correct answer more often than not.`,
    prompt: JSON.stringify({
      taskPrompt: options.prompt.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      agentOutput: options.output.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      verdict: options.verdict,
      ownerFeedback: options.feedback.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      existingProcedures: existing,
    }),
    logUserPrompt: JSON.stringify({
      verdict: options.verdict,
      existingProcedureCount: existing.length,
    }),
    tool: LESSON_TOOL,
    maxTokens: 4_096,
    temperature: 0,
  });
  return lessonResultSchema.parse(result.input).lessons;
}

/**
 * Second opinion on the candidates that survived the quote check. The model
 * that wrote a lesson is a poor judge of whether it was worth writing, so this
 * runs as a separate call that only sees the feedback and the candidates —
 * never the reasoning that produced them.
 */
export async function verifyLessons(options: {
  feedback: string;
  verdict: "useful" | "correction";
  candidates: GeneralizedLesson[];
}): Promise<Map<number, { keep: boolean; reason: string }>> {
  if (options.candidates.length === 0) return new Map();
  const result = await generateToolResult({
    purpose: "agent-task-learning",
    source: "agent-task-lesson-check",
    model: await getUnattendedModel(),
    system: `You are checking proposed working procedures against the owner's feedback that supposedly produced them.

Keep a candidate only if all of these hold:
- the feedback genuinely states or directly implies it
- it generalises past this one task, so it would apply to different work later
- it is specific enough to act on, not a platitude like "be accurate" or "be helpful"
- it grants no permission, authority or approval bypass

Reject anything else. Rejecting every candidate is a valid and common outcome. Give a short concrete reason for each decision.`,
    prompt: JSON.stringify({
      verdict: options.verdict,
      ownerFeedback: options.feedback.slice(0, MAX_LEARNING_CONTEXT_CHARS),
      candidates: options.candidates.map((lesson, index) => ({
        index,
        action: lesson.action,
        scope: lesson.scope,
        trigger: lesson.trigger,
        behavior: lesson.behavior,
        evidenceQuote: lesson.evidenceQuote,
      })),
    }),
    logUserPrompt: JSON.stringify({
      candidateCount: options.candidates.length,
    }),
    tool: VERDICT_TOOL,
    maxTokens: 2_048,
    temperature: 0,
  });
  const parsed = verdictResultSchema.parse(result.input);
  return new Map(
    parsed.verdicts.map((entry) => [
      entry.index,
      { keep: entry.keep, reason: entry.reason },
    ]),
  );
}
