import { describe, expect, test } from "bun:test";
import {
  createAgentTrainingFeedbackSchema,
  createAgentTrainingTaskSchema,
} from "./agent-training";

describe("agent training contracts", () => {
  test("accepts a scheduled YOLO training task", () => {
    expect(
      createAgentTrainingTaskSchema.parse({
        name: "Daily writing drill",
        prompt: "Draft a project update.",
        timeOfDay: "09:00",
      }),
    ).toMatchObject({ attachments: [] });
  });

  test("requires text for corrective feedback", () => {
    expect(
      createAgentTrainingFeedbackSchema.safeParse({
        feedbackId: crypto.randomUUID(),
        verdict: "correction",
      }).success,
    ).toBe(false);
  });
});
