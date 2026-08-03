import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import type { IAgentProcedure } from "@/models/AgentProcedure";
import {
  findNearDuplicate,
  type GeneralizedLesson,
  quoteAppearsIn,
} from "./lessons";

function procedure(scope: string, behavior: string): IAgentProcedure {
  return {
    _id: new Types.ObjectId(),
    scope,
    trigger: "when it applies",
    behavior,
    exceptions: [],
    supportingFeedbackIds: [],
    evidenceIds: [],
    confidence: 0.8,
  } as unknown as IAgentProcedure;
}

function lesson(overrides: Partial<GeneralizedLesson>): GeneralizedLesson {
  return {
    action: "create",
    exceptions: [],
    confidence: 0.8,
    reason: "because",
    ...overrides,
  };
}

describe("quoteAppearsIn", () => {
  const feedback =
    "Don't bury the numbers in prose — lead with the table, then explain it.";

  test("accepts a verbatim span", () => {
    expect(quoteAppearsIn("lead with the table", feedback)).toBe(true);
  });

  test("tolerates punctuation and casing drift", () => {
    expect(quoteAppearsIn("Lead with the table,", feedback)).toBe(true);
  });

  test("tolerates a normalised dash and collapsed whitespace", () => {
    expect(quoteAppearsIn("in  prose - lead   with the table", feedback)).toBe(
      true,
    );
  });

  test("rejects a paraphrase", () => {
    expect(quoteAppearsIn("put the table first", feedback)).toBe(false);
  });

  test("rejects an invented quote", () => {
    expect(quoteAppearsIn("always use bullet points", feedback)).toBe(false);
  });

  test("rejects an empty quote", () => {
    expect(quoteAppearsIn("   ", feedback)).toBe(false);
  });
});

describe("findNearDuplicate", () => {
  const existing = [
    procedure(
      "Writing project updates",
      "Lead with the table of numbers, then explain it in prose.",
    ),
    procedure("Booking travel", "Prefer direct flights under six hours."),
  ];

  test("matches a restatement of an existing procedure", () => {
    expect(
      findNearDuplicate(
        lesson({
          scope: "Writing project updates",
          behavior: "Lead with the table, explain in prose after.",
        }),
        existing,
      ),
    ).toBe(existing[0] as IAgentProcedure);
  });

  test("leaves a genuinely new rule alone", () => {
    expect(
      findNearDuplicate(
        lesson({
          scope: "Reviewing pull requests",
          behavior: "Check migrations before approving schema changes.",
        }),
        existing,
      ),
    ).toBeNull();
  });

  test("returns null when the candidate has no usable text", () => {
    expect(findNearDuplicate(lesson({}), existing)).toBeNull();
  });
});
