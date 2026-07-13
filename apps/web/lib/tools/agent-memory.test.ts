import { describe, expect, test } from "bun:test";
import { agentMemoryTools } from "./agent-memory";

describe("Gate E agent tools", () => {
  test("keeps all goal and procedure mutations behind write approval", () => {
    const writes = new Set(
      agentMemoryTools
        .filter((tool) => tool.isWrite)
        .map((tool) => tool.schema.name),
    );
    expect(writes).toEqual(
      new Set([
        "create_agent_goal",
        "update_agent_goal",
        "create_agent_procedure",
        "retire_agent_procedure",
      ]),
    );
  });

  test("exposes derived state through read-only tools", () => {
    for (const name of [
      "list_agent_goals",
      "list_agent_procedures",
      "get_personal_user_model",
    ]) {
      expect(
        agentMemoryTools.find((tool) => tool.schema.name === name)?.isWrite,
      ).toBe(false);
    }
  });
});
