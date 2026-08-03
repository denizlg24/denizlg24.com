import { describe, expect, mock, test } from "bun:test";
import { Types } from "mongoose";
import type { IAgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import type { IAgentProcedure } from "@/models/AgentProcedure";
import type { IAgentTask } from "@/models/AgentTask";
import type { IAgentTaskRun } from "@/models/AgentTaskRun";
import { type FeedbackDependencies, recordAgentTaskFeedback } from "./learning";
import type { GeneralizedLesson } from "./lessons";

const runId = "507f1f77bcf86cd799439011";
const taskId = new Types.ObjectId("507f1f77bcf86cd799439012");
const procedureId = new Types.ObjectId("507f1f77bcf86cd799439013");
const feedbackEventId = new Types.ObjectId("507f1f77bcf86cd799439014");
const occurredAt = new Date("2026-08-03T12:00:00.000Z");

const FEEDBACK =
  "Lead with the numbers table before any prose, every time you write me a summary.";

function taskRun() {
  const run = {
    _id: new Types.ObjectId(runId),
    taskId,
    taskName: "Daily research",
    trigger: "manual",
    status: "completed",
    scheduledFor: occurredAt,
    output: "Research result",
    toolCalls: [],
    feedback: undefined as IAgentTaskRun["feedback"],
    createdAt: occurredAt,
    updatedAt: occurredAt,
    save: mock(async () => run),
  };
  return run as unknown as IAgentTaskRun;
}

function agentTask() {
  return {
    _id: taskId,
    prompt: "Summarise this week's numbers.",
  } as unknown as IAgentTask;
}

function procedure() {
  return {
    _id: procedureId,
    scope: "Writing summaries",
    trigger: "When summarising numbers",
    behavior: "Lead with the numbers table before prose.",
    exceptions: [],
    supportingFeedbackIds: [],
    evidenceIds: [],
    confidence: 0.8,
  } as unknown as IAgentProcedure;
}

function setup(options?: {
  run?: IAgentTaskRun;
  existing?: IAgentProcedure[];
  lessons?: GeneralizedLesson[];
  verdicts?: Map<number, { keep: boolean; reason: string }>;
}) {
  const run = options?.run ?? taskRun();
  const createProcedure = mock(
    async () =>
      ({
        _id: procedureId,
        scope: "Writing summaries",
        behavior: "Lead with the numbers table before prose.",
      }) as unknown as IAgentProcedure,
  );
  const updateProcedure = mock(
    async () =>
      ({
        _id: procedureId,
        scope: "Writing summaries",
        behavior: "Lead with the numbers table before prose.",
      }) as unknown as IAgentProcedure,
  );
  const distill = mock(async () => options?.lessons ?? []);
  const verify = mock(
    async () =>
      options?.verdicts ??
      new Map(
        (options?.lessons ?? []).map((_, index) => [
          index,
          { keep: true, reason: "grounded" },
        ]),
      ),
  );
  const claimRun = mock(
    async (
      _runId: string,
      feedback: IAgentTaskRun["feedback"],
    ): Promise<IAgentTaskRun | null> => {
      run.feedback = feedback;
      return run;
    },
  );

  const dependencies: Partial<FeedbackDependencies> = {
    connect: mock(async () => undefined),
    findDuplicate: mock(async () => null),
    claimRun,
    findRun: mock(async () => run),
    findTask: mock(async () => agentTask()),
    observe: mock(async () => ({
      status: "created" as const,
      eventId: "ev-1",
    })) as unknown as FeedbackDependencies["observe"],
    createFeedbackEvent: mock(
      async () => ({ _id: feedbackEventId }) as unknown as IAgentFeedbackEvent,
    ),
    findRelevant: mock(async () => options?.existing ?? []),
    distill: distill as unknown as FeedbackDependencies["distill"],
    verify: verify as unknown as FeedbackDependencies["verify"],
    createProcedure,
    updateProcedure,
    now: () => occurredAt,
  };
  return { run, dependencies, createProcedure, updateProcedure, verify };
}

function input(text = FEEDBACK) {
  return {
    feedbackId: crypto.randomUUID(),
    verdict: "correction" as const,
    text,
  };
}

describe("recordAgentTaskFeedback", () => {
  test("writes a procedure when the lesson quotes the owner", async () => {
    const { dependencies, createProcedure } = setup({
      lessons: [
        {
          action: "create",
          scope: "Writing summaries",
          trigger: "When summarising numbers",
          behavior: "Lead with the numbers table before prose.",
          exceptions: [],
          confidence: 0.9,
          evidenceQuote: "Lead with the numbers table before any prose",
          reason: "Owner stated the ordering explicitly.",
        },
      ],
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).toHaveBeenCalledTimes(1);
    expect(result.learnedProcedures).toHaveLength(1);
    expect(result.learnedProcedures[0]?.action).toBe("created");
    expect(result.rejected).toHaveLength(0);
  });

  test("drops a lesson whose quote was never written", async () => {
    const { dependencies, createProcedure } = setup({
      lessons: [
        {
          action: "create",
          scope: "Writing summaries",
          trigger: "Always",
          behavior: "Use bullet points for everything.",
          exceptions: [],
          confidence: 0.9,
          evidenceQuote: "always use bullet points",
          reason: "Invented.",
        },
      ],
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(result.learnedProcedures).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("never wrote");
  });

  test("drops a lesson with no quote at all", async () => {
    const { dependencies, createProcedure } = setup({
      lessons: [
        {
          action: "create",
          scope: "Writing summaries",
          trigger: "Always",
          behavior: "Be thorough.",
          exceptions: [],
          confidence: 0.9,
          reason: "No quote supplied.",
        },
      ],
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(result.rejected[0]?.reason).toContain("No quote");
  });

  test("drops a quoted lesson the grounding check rejects", async () => {
    const { dependencies, createProcedure } = setup({
      lessons: [
        {
          action: "create",
          scope: "Everything",
          trigger: "Always",
          behavior: "Be accurate.",
          exceptions: [],
          confidence: 0.9,
          evidenceQuote: "every time you write me a summary",
          reason: "Too generic.",
        },
      ],
      verdicts: new Map([[0, { keep: false, reason: "Platitude." }]]),
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(result.rejected[0]?.reason).toBe("Platitude.");
  });

  test("drops a lesson the grounding check did not rule on", async () => {
    const { dependencies, createProcedure } = setup({
      lessons: [
        {
          action: "create",
          scope: "Writing summaries",
          trigger: "When summarising",
          behavior: "Lead with the numbers table.",
          exceptions: [],
          confidence: 0.9,
          evidenceQuote: "Lead with the numbers table",
          reason: "Grounded but unjudged.",
        },
      ],
      verdicts: new Map(),
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(result.rejected[0]?.reason).toContain("did not confirm");
  });

  test("folds a restated rule into the existing procedure", async () => {
    const existing = procedure();
    const { dependencies, createProcedure, updateProcedure } = setup({
      existing: [existing],
      lessons: [
        {
          action: "create",
          scope: "Writing summaries",
          trigger: "When summarising numbers",
          behavior: "Lead with the numbers table before prose, always.",
          exceptions: [],
          confidence: 0.95,
          evidenceQuote: "Lead with the numbers table before any prose",
          reason: "Owner repeated the same rule.",
        },
      ],
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(updateProcedure).toHaveBeenCalledTimes(1);
    expect(result.learnedProcedures[0]?.action).toBe("updated");
  });

  test("drops an update aimed at a procedure that does not exist", async () => {
    const { dependencies, updateProcedure } = setup({
      lessons: [
        {
          action: "update",
          targetId: "507f1f77bcf86cd799439099",
          scope: "Writing summaries",
          trigger: "When summarising",
          behavior: "Lead with the table.",
          exceptions: [],
          confidence: 0.9,
          evidenceQuote: "Lead with the numbers table",
          reason: "Bad target.",
        },
      ],
    });
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(updateProcedure).not.toHaveBeenCalled();
    expect(result.rejected[0]?.reason).toContain("does not exist");
  });

  test("records the verdict even when distillation throws", async () => {
    const { run, dependencies } = setup();
    dependencies.distill = mock(async () => {
      throw new Error("gateway down");
    }) as unknown as FeedbackDependencies["distill"];
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(run.feedback?.verdict).toBe("correction");
    expect(result.rejected[0]?.reason).toContain("gateway down");
  });

  test("is idempotent on a replayed feedback id", async () => {
    const { dependencies, createProcedure } = setup();
    dependencies.findDuplicate = mock(async () => taskRun());
    const result = await recordAgentTaskFeedback(runId, input(), dependencies);
    expect(createProcedure).not.toHaveBeenCalled();
    expect(result.learnedProcedures).toHaveLength(0);
  });

  test("refuses a run that already carries feedback", async () => {
    const { dependencies } = setup();
    dependencies.claimRun = mock(async () => null);
    const existing = taskRun();
    existing.feedback = {
      feedbackId: crypto.randomUUID(),
      verdict: "useful",
      learnedProcedureIds: [],
      createdAt: occurredAt,
    };
    dependencies.findRun = mock(async () => existing);
    await expect(
      recordAgentTaskFeedback(runId, input(), dependencies),
    ).rejects.toThrow("already has feedback");
  });

  test("refuses a run that has not finished", async () => {
    const { dependencies } = setup();
    dependencies.claimRun = mock(async () => null);
    await expect(
      recordAgentTaskFeedback(runId, input(), dependencies),
    ).rejects.toThrow("has not finished");
  });
});
