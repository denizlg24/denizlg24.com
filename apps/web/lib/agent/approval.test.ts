import { describe, expect, test } from "bun:test";
import type { ConnectorToolBinding } from "@/lib/connectors/toolset";
import { createApprovalPolicy, isReadOnlyCall } from "./approval";

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

describe("catalog calls", () => {
  const forgeDelete: ConnectorToolBinding = {
    ...notes,
    toolName: "forge_target_delete",
    readOnly: false,
    destructive: true,
    actions: undefined,
  };
  const targets = new Map([
    ["web_notes", notes],
    ["web_agent_memory_goals", memory],
    ["forge_target_delete", forgeDelete],
  ]);
  const callTool = (
    toolName: string,
    readOnly: boolean,
    destructive: boolean,
  ): ConnectorToolBinding => ({
    ...notes,
    toolName,
    readOnly,
    destructive,
    actions: undefined,
    catalogTargets: targets,
  });
  const read = callTool("catalog_read", true, false);
  const write = callTool("catalog_write", false, false);
  const destroy = callTool("catalog_destructive", false, true);

  function catalogPolicy(
    overrides: Partial<Parameters<typeof createApprovalPolicy>[0]> = {},
  ) {
    return policy({
      connectorBindings: new Map([
        ["denizlg24__catalog_read", read],
        ["denizlg24__catalog_write", write],
        ["denizlg24__catalog_destructive", destroy],
      ]),
      ...overrides,
    });
  }

  test("gates by the operation the call names, like the tool by name", () => {
    const decide = catalogPolicy();
    expect(
      decide({
        toolName: "denizlg24__catalog_read",
        input: { resource: "web_notes", operation: "list" },
      }),
    ).toBeUndefined();
    expect(
      decide({
        toolName: "denizlg24__catalog_write",
        input: { resource: "web_notes", operation: "create", args: {} },
      }),
    ).toEqual({ type: "user-approval" });
    expect(
      decide({
        toolName: "denizlg24__catalog_destructive",
        input: { resource: "web_notes", operation: "delete" },
      }),
    ).toEqual({ type: "user-approval", reason: "Destructive" });
    expect(
      decide({
        toolName: "denizlg24__catalog_destructive",
        input: { resource: "forge_target_delete", args: {} },
      }),
    ).toEqual({ type: "user-approval", reason: "Destructive" });
  });

  test("a write named through the read tool still asks", () => {
    expect(
      catalogPolicy()({
        toolName: "denizlg24__catalog_read",
        input: { resource: "web_notes", operation: "delete" },
      }),
    ).toEqual({ type: "user-approval", reason: "Destructive" });
  });

  test("a resource it may not reach is denied, even in yolo", () => {
    const decide = catalogPolicy({ executionMode: "yolo" });
    for (const input of [
      { resource: "web_api_keys", operation: "list" },
      { operation: "list" },
      "web_notes",
    ]) {
      expect(
        decide({ toolName: "denizlg24__catalog_read", input }),
      ).toMatchObject({ type: "denied" });
    }
  });

  test("incognito refuses memory writes routed through the catalog", () => {
    const decide = catalogPolicy({
      memoryMode: "incognito",
      executionMode: "yolo",
    });
    expect(
      decide({
        toolName: "denizlg24__catalog_write",
        input: { resource: "web_agent_memory_goals", operation: "create" },
      }),
    ).toMatchObject({ type: "denied" });
    expect(
      decide({
        toolName: "denizlg24__catalog_read",
        input: { resource: "web_agent_memory_goals", operation: "list" },
      }),
    ).toBeUndefined();
  });

  test("isReadOnlyCall judges the routed operation", () => {
    expect(
      isReadOnlyCall(read, { resource: "web_notes", operation: "list" }),
    ).toBe(true);
    expect(
      isReadOnlyCall(write, { resource: "web_notes", operation: "list" }),
    ).toBe(false);
    expect(
      isReadOnlyCall(read, { resource: "missing", operation: "list" }),
    ).toBe(false);
  });
});
