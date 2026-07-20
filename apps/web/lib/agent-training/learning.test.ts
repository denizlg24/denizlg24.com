import { describe, expect, mock, test } from "bun:test";
import { Types } from "mongoose";
import type { IAgentFeedbackEvent } from "@/models/AgentFeedbackEvent";
import type { IAgentProcedure } from "@/models/AgentProcedure";
import type { IAgentTrainingRun } from "@/models/AgentTrainingRun";
import type { IAgentTrainingTask } from "@/models/AgentTrainingTask";
import {
  type FeedbackDependencies,
  type GeneralizedLesson,
  recordTrainingFeedback,
} from "./learning";

const runId = "507f1f77bcf86cd799439011";
const taskId = new Types.ObjectId("507f1f77bcf86cd799439012");
const procedureId = new Types.ObjectId("507f1f77bcf86cd799439013");
const feedbackEventId = new Types.ObjectId("507f1f77bcf86cd799439014");
const occurredAt = new Date("2026-07-20T12:00:00.000Z");

function trainingRun(status: IAgentTrainingRun["status"] = "learning") {
  const run = {
    _id: new Types.ObjectId(runId),
    taskId,
    taskName: "Daily research",
    trigger: "manual",
    status,
    scheduledFor: occurredAt,
    output: "Research result",
    toolCalls: [],
    createdAt: occurredAt,
    updatedAt: occurredAt,
    save: mock(async () => run),
  };
  return run as unknown as IAgentTrainingRun;
}

function trainingTask() {
  return {
    _id: taskId,
    prompt: "Research comparable products and summarize the decision.",
  } as unknown as IAgentTrainingTask;
}

function procedure() {
  return {
    _id: procedureId,
    scope: "Product research",
    trigger: "When comparing products",
    behavior: "Compare the same decision criteria.",
    exceptions: [],
    supportingFeedbackIds: [],
    evidenceIds: [],
    confidence: 0.8,
  } as unknown as IAgentProcedure;
}

function setup(options?: {
  run?: IAgentTrainingRun;
  existing?: IAgentProcedure[];
  lessons?: GeneralizedLesson[];
}) {
  const run = options?.run ?? trainingRun();
  const restoreRun = mock(async () => {
    run.status = "awaiting-feedback";
  });
  const createProcedure = mock(
    async () => ({ _id: procedureId }) as unknown as IAgentProcedure,
  );
  const updateProcedure = mock(
    async () => ({ _id: procedureId }) as unknown as IAgentProcedure,
  );
  const findDuplicate = mock(
    async (_feedbackId: string): Promise<IAgentTrainingRun | null> => null,
  );
  const claimRun = mock(
    async (_runId: string): Promise<IAgentTrainingRun | null> => run,
  );
  const observe = mock(async () => ({
    status: "created" as const,
    eventId: "ev-1",
  }));
  const dependencies: FeedbackDependencies = {
    connect: mock(async () => {}),
    findDuplicate,
    claimRun,
    findRun: mock(
      async (_runId: string): Promise<IAgentTrainingRun | null> => run,
    ),
    restoreRun,
    findTask: mock(async () => trainingTask()),
    observe,
    createFeedbackEvent: mock(
      async () => ({ _id: feedbackEventId }) as unknown as IAgentFeedbackEvent,
    ),
    findRelevant: mock(async () => options?.existing ?? []),
    distill: mock(async () => options?.lessons ?? []),
    createProcedure,
    updateProcedure,
    now: () => occurredAt,
  };
  return {
    run,
    dependencies,
    findDuplicate,
    claimRun,
    observe,
    restoreRun,
    createProcedure,
    updateProcedure,
  };
}

const usefulFeedback = {
  feedbackId: "9fa3e791-b155-4719-bda8-f6542ea421f3",
  verdict: "useful" as const,
  text: "Keep the comparison structured around decision criteria.",
};

describe("recordTrainingFeedback", () => {
  test("returns an existing run for duplicate feedback", async () => {
    const duplicate = trainingRun("completed");
    const setupResult = setup();
    setupResult.findDuplicate.mockResolvedValueOnce(duplicate);

    const result = await recordTrainingFeedback(
      runId,
      usefulFeedback,
      setupResult.dependencies,
    );

    expect(result.run.id).toBe(runId);
    expect(result.learnedProcedures).toEqual([]);
    expect(setupResult.claimRun).not.toHaveBeenCalled();
  });

  test("rejects a run that is not awaiting feedback", async () => {
    const setupResult = setup();
    setupResult.claimRun.mockResolvedValueOnce(null);

    await expect(
      recordTrainingFeedback(runId, usefulFeedback, setupResult.dependencies),
    ).rejects.toThrow("Training run is not awaiting feedback");
    expect(setupResult.observe).not.toHaveBeenCalled();
  });

  test("restores the claim when evidence creation fails", async () => {
    const setupResult = setup();
    setupResult.observe.mockRejectedValueOnce(
      new Error("evidence unavailable"),
    );

    await expect(
      recordTrainingFeedback(runId, usefulFeedback, setupResult.dependencies),
    ).rejects.toThrow("evidence unavailable");
    expect(setupResult.restoreRun).toHaveBeenCalledWith(runId);
    expect(setupResult.run.status).toBe("awaiting-feedback");
    expect(setupResult.run.feedback).toBeUndefined();
  });

  test("completes without a procedure for a none lesson", async () => {
    const setupResult = setup({
      lessons: [
        {
          action: "none",
          exceptions: [],
          confidence: 0.8,
          reason: "No reusable signal",
        },
      ],
    });

    const result = await recordTrainingFeedback(
      runId,
      usefulFeedback,
      setupResult.dependencies,
    );

    expect(result.learnedProcedures).toEqual([]);
    expect(setupResult.run.status).toBe("completed");
    expect(setupResult.createProcedure).not.toHaveBeenCalled();
    expect(setupResult.updateProcedure).not.toHaveBeenCalled();
  });

  test("creates a generalized procedure", async () => {
    const setupResult = setup({
      lessons: [
        {
          action: "create",
          scope: "Product research",
          trigger: "When comparing products",
          behavior: "Compare consistent decision criteria.",
          exceptions: [],
          confidence: 0.9,
          reason: "Owner confirmed the format",
        },
      ],
    });

    const result = await recordTrainingFeedback(
      runId,
      usefulFeedback,
      setupResult.dependencies,
    );

    expect(result.learnedProcedures).toEqual([
      { id: procedureId.toString(), action: "created" },
    ]);
    expect(setupResult.createProcedure).toHaveBeenCalledTimes(1);
    expect(setupResult.run.feedback?.learnedProcedureIds.map(String)).toEqual([
      procedureId.toString(),
    ]);
  });

  test("updates a matching procedure", async () => {
    const setupResult = setup({
      existing: [procedure()],
      lessons: [
        {
          action: "update",
          targetId: procedureId.toString(),
          scope: "Product research",
          trigger: "When comparing products",
          behavior: "Compare consistent decision criteria.",
          exceptions: [],
          confidence: 0.9,
          reason: "Owner refined the procedure",
        },
      ],
    });

    const result = await recordTrainingFeedback(
      runId,
      usefulFeedback,
      setupResult.dependencies,
    );

    expect(result.learnedProcedures[0]?.action).toBe("updated");
    expect(setupResult.updateProcedure).toHaveBeenCalledWith(
      procedureId.toString(),
      expect.objectContaining({ lifecycle: "active" }),
    );
  });

  test("retires a contradicted procedure", async () => {
    const setupResult = setup({
      existing: [procedure()],
      lessons: [
        {
          action: "retire",
          targetId: procedureId.toString(),
          exceptions: [],
          confidence: 0.9,
          reason: "Owner rejected the old procedure",
        },
      ],
    });

    const result = await recordTrainingFeedback(
      runId,
      usefulFeedback,
      setupResult.dependencies,
    );

    expect(result.learnedProcedures[0]?.action).toBe("retired");
    expect(setupResult.updateProcedure).toHaveBeenCalledWith(
      procedureId.toString(),
      expect.objectContaining({ lifecycle: "retired" }),
    );
  });
});
