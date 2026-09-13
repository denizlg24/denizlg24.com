import { describe, expect, test } from "bun:test";
import type { ConnectorToolBinding } from "@/lib/connectors/toolset";
import { createApprovalPolicy } from "./approval";

const notes: ConnectorToolBinding = {
  connectorId: "c1",
  connectorSlug: "denizlg24",
  connectorName: "denizlg24",
  approval: "reads-auto",
  builtIn: true,
  toolName: "web_notes",
  readOnly: false,
  destructive: true,
  actions: {
    list: { readOnly: true, destructive: false },
    create: { readOnly: false, destructive: false },
    delete: { readOnly: false, destructive: true },
  },
};
const memory: ConnectorToolBinding = {
  ...notes,
  toolName: "web_agent_memory_goals",
  destructive: false,
  actions: {
    list: { readOnly: true, destructive: false },
    create: { readOnly: false, destructive: false },
  },
};
const external: ConnectorToolBinding = {
  connectorId: "c2",
  connectorSlug: "linear",
  connectorName: "Linear",
  approval: "reads-auto",
  builtIn: false,
  toolName: "list_issues",
  readOnly: true,
  destructive: false,
};

function policy(
  overrides: Partial<Parameters<typeof createApprovalPolicy>[0]> = {},
) {
  return createApprovalPolicy({
    executionMode: "interactive",
    memoryMode: "enabled",
    connectorBindings: new Map([
      ["denizlg24__web_notes", notes],
      ["denizlg24__web_agent_memory_goals", memory],
      ["linear__list_issues", external],
    ]),
    builtinWrites: new Set(["save_memory"]),
    ...overrides,
  });
}

describe("createApprovalPolicy", () => {
  test("reads-auto gates by the chosen action", () => {
    const decide = policy();
    expect(
      decide({ toolName: "denizlg24__web_notes", input: { action: "list" } }),
    ).toBeUndefined();
    expect(
      decide({ toolName: "denizlg24__web_notes", input: { action: "create" } }),
    ).toEqual({
      type: "user-approval",
    });
    expect(
      decide({ toolName: "denizlg24__web_notes", input: { action: "delete" } }),
    ).toEqual({
      type: "user-approval",
      reason: "Destructive",
    });
    expect(
      decide({ toolName: "linear__list_issues", input: {} }),
    ).toBeUndefined();
  });

  test("an unknown action on an action tool asks", () => {
    expect(policy()({ toolName: "denizlg24__web_notes", input: {} })).toEqual({
      type: "user-approval",
      reason: "Destructive",
    });
  });

  test("yolo and never-ask run everything; always-ask asks for reads too", () => {
    expect(
      policy({ executionMode: "yolo" })({
        toolName: "denizlg24__web_notes",
        input: { action: "delete" },
      }),
    ).toBeUndefined();
    const strict = policy({
      connectorBindings: new Map([
        ["linear__list_issues", { ...external, approval: "always-ask" }],
      ]),
    });
    expect(strict({ toolName: "linear__list_issues", input: {} })).toEqual({
      type: "user-approval",
    });
  });

  test("incognito refuses memory writes even in yolo", () => {
    const decide = policy({ memoryMode: "incognito", executionMode: "yolo" });
    expect(
      decide({
        toolName: "denizlg24__web_agent_memory_goals",
        input: { action: "create" },
      }),
    ).toMatchObject({ type: "denied" });
    expect(
      decide({
        toolName: "denizlg24__web_agent_memory_goals",
        input: { action: "list" },
      }),
    ).toBeUndefined();
  });

  test("built-in writes ask only in interactive mode", () => {
    expect(policy()({ toolName: "save_memory", input: {} })).toBe(
      "user-approval",
    );
    expect(
      policy({ executionMode: "yolo" })({ toolName: "save_memory", input: {} }),
    ).toBeUndefined();
    expect(policy()({ toolName: "get_day", input: {} })).toBeUndefined();
  });
});
