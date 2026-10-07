import { describe, expect, mock, test } from "bun:test";
import type { McpToolDefinition } from "@/lib/connectors/service";

mock.module("server-only", () => ({}));

const {
  formatTriageToolCatalogue,
  isReadOnlyTriageCall,
  isTriageActionToolName,
  selectTriageActionTools,
  validateTriageProposals,
} = await import("./triage-actions");

const ACTIONS_META = "com.denizlg24/actions";

function definition(
  name: string,
  actions?: Record<string, { readOnly: boolean; destructive: boolean }>,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
): McpToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object", properties: {} },
    ...(annotations ? { annotations } : {}),
    ...(actions ? { _meta: { [ACTIONS_META]: actions } } : {}),
  };
}

const people = definition("web_people", {
  list: { readOnly: true, destructive: false },
  get: { readOnly: true, destructive: false },
  create: { readOnly: false, destructive: false },
  update: { readOnly: false, destructive: false },
  delete: { readOnly: false, destructive: true },
});
const rules = definition("web_finance_rules", {
  list: { readOnly: true, destructive: false },
  create: { readOnly: false, destructive: false },
});
const tools = selectTriageActionTools([
  people,
  rules,
  definition("web_api_keys", { list: { readOnly: true, destructive: false } }),
  definition("web_agent_memory_memories"),
  definition("web_kanban_cards"),
  definition("forge_target_update"),
]);

describe("tool selection", () => {
  test("keeps web tools and drops denied and non-web ones", () => {
    expect([...tools.keys()].sort()).toEqual([
      "web_finance_rules",
      "web_people",
    ]);
    expect(isTriageActionToolName("web_authenticator")).toBe(false);
    expect(isTriageActionToolName("cloud_user_remove")).toBe(false);
  });

  test("honours the connector's disabled tools", () => {
    const selected = selectTriageActionTools([people], new Set(["web_people"]));
    expect(selected.size).toBe(0);
  });

  test("the catalogue lists reads and writes per tool", () => {
    expect(formatTriageToolCatalogue(tools)).toContain(
      "web_people: web_people tool [reads: list, get; writes: create, update, delete]",
    );
  });
});

describe("read-only calls", () => {
  const peopleTool = tools.get("web_people");
  if (!peopleTool) throw new Error("web_people missing");

  test("judged per action", () => {
    expect(isReadOnlyTriageCall(peopleTool, { action: "list" })).toBe(true);
    expect(isReadOnlyTriageCall(peopleTool, { action: "delete" })).toBe(false);
  });

  test("an action-bearing tool without an action is not read-only", () => {
    expect(isReadOnlyTriageCall(peopleTool, {})).toBe(false);
  });
});

describe("proposal validation", () => {
  test("keeps a well-formed write and derives delete from the destructive flag", () => {
    const proposals = validateTriageProposals(
      [
        {
          tool: "web_people",
          arguments: { action: "delete", id: "p1" },
          effect: "update",
          summary: "Remove Ana Silva",
        },
        {
          tool: "web_finance_rules",
          arguments: { action: "create", name: "Spotify", amountMinor: 1199 },
          effect: "create",
          summary: "Add Spotify at 11.99 a month",
        },
      ],
      tools,
    );
    expect(proposals).toEqual([
      {
        tool: "web_people",
        action: "delete",
        arguments: { action: "delete", id: "p1" },
        summary: "Remove Ana Silva",
        effect: "delete",
      },
      {
        tool: "web_finance_rules",
        action: "create",
        arguments: { action: "create", name: "Spotify", amountMinor: 1199 },
        summary: "Add Spotify at 11.99 a month",
        effect: "create",
      },
    ]);
  });

  test("drops reads, unknown actions, denied tools and empty summaries", () => {
    const proposals = validateTriageProposals(
      [
        { tool: "web_people", arguments: { action: "list" }, summary: "x" },
        { tool: "web_people", arguments: { action: "merge" }, summary: "x" },
        { tool: "web_api_keys", arguments: { action: "create" }, summary: "x" },
        { tool: "web_people", arguments: { action: "create" }, summary: " " },
        { tool: "web_people", arguments: "create", summary: "x" },
      ],
      tools,
    );
    expect(proposals).toEqual([]);
  });

  test("caps the number of proposals", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      tool: "web_people",
      arguments: { action: "create", name: `P${index}` },
      effect: "create",
      summary: `Add P${index}`,
    }));
    expect(validateTriageProposals(many, tools)).toHaveLength(5);
  });

  test("a non-array answer is no proposals", () => {
    expect(validateTriageProposals(undefined, tools)).toEqual([]);
  });
});
