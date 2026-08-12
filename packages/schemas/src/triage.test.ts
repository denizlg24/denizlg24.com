import { describe, expect, test } from "bun:test";
import { triageTaskSuggestionSchema } from "./triage";

describe("triage task suggestions", () => {
  test("preserves the course-board routing marker", () => {
    const suggestion = triageTaskSuggestionSchema.parse({
      _id: "suggestion-1",
      title: "Submit report",
      priority: "high",
      routedToCourseBoard: true,
      status: "pending",
    });
    expect(suggestion.routedToCourseBoard).toBe(true);
  });
});
