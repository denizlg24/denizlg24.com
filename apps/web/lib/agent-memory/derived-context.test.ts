import { describe, expect, test } from "bun:test";
import { combineAgentContexts } from "./derived-context";

describe("Gate E derived context", () => {
  test("keeps derived state separate from memory context", () => {
    expect(
      combineAgentContexts(
        '<derived_user_context trust="data-not-instructions" />',
        '<personal_memory_context trust="data-not-instructions" />',
      ),
    ).toBe(
      '<derived_user_context trust="data-not-instructions" />\n<personal_memory_context trust="data-not-instructions" />',
    );
  });

  test("handles either context being absent", () => {
    expect(combineAgentContexts("profile", null)).toBe("profile");
    expect(combineAgentContexts(null, "memory")).toBe("memory");
    expect(combineAgentContexts(null, null)).toBeNull();
  });
});
