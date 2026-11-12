import { describe, expect, test } from "bun:test";
import type { QuestionBody } from "@repo/schemas";
import { attemptScore, gradeObjective } from "./quiz-grading";

describe("gradeObjective", () => {
  const mcq: QuestionBody = {
    kind: "mcq",
    options: ["a", "b", "c"],
    correctIndex: 1,
  };

  test("mcq compares the chosen index", () => {
    expect(gradeObjective(mcq, 1)).toEqual({ credit: 1, correct: true });
    expect(gradeObjective(mcq, 2)).toEqual({ credit: 0, correct: false });
  });

  test("an mcq answer of the wrong type is wrong, not a crash", () => {
    expect(gradeObjective(mcq, "1")).toEqual({ credit: 0, correct: false });
    expect(gradeObjective(mcq, null)).toEqual({ credit: 0, correct: false });
  });

  test("true-false compares the boolean", () => {
    const tf: QuestionBody = { kind: "true-false", correct: false };
    expect(gradeObjective(tf, false)).toEqual({ credit: 1, correct: true });
    expect(gradeObjective(tf, true)).toEqual({ credit: 0, correct: false });
    expect(gradeObjective(tf, 0)).toEqual({ credit: 0, correct: false });
  });

  test("short answers are left to the model", () => {
    expect(gradeObjective({ kind: "short", reference: "x" }, "x")).toBeNull();
  });
});

describe("attemptScore", () => {
  test("is the mean credit, with partial credit", () => {
    expect(attemptScore([{ credit: 1 }, { credit: 0.5 }, { credit: 0 }])).toBe(
      0.5,
    );
  });

  test("an empty attempt scores zero", () => {
    expect(attemptScore([])).toBe(0);
  });
});
