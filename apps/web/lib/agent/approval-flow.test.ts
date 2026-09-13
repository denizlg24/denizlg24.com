import { describe, expect, test } from "bun:test";
import type { AgentUIMessage } from "@repo/schemas";
import {
  convertToModelMessages,
  dynamicTool,
  jsonSchema,
  simulateReadableStream,
  streamText,
  type ToolSet,
  toUIMessageStream,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { ConnectorToolBinding } from "@/lib/connectors/toolset";
import { createApprovalPolicy } from "./approval";
import { applyClientDecisions } from "./merge";

const usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer T>
    ? T
    : never;

function scripted(steps: StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const chunks = steps[call] ?? steps.at(-1) ?? [];
      call += 1;
      return { stream: simulateReadableStream<StreamPart>({ chunks }) };
    },
  });
}

const binding: ConnectorToolBinding = {
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
    delete: { readOnly: false, destructive: true },
  },
};

async function turn(options: {
  model: MockLanguageModelV4;
  tools: ToolSet;
  history: AgentUIMessage[];
}): Promise<AgentUIMessage[]> {
  const policy = createApprovalPolicy({
    executionMode: "interactive",
    memoryMode: "enabled",
    connectorBindings: new Map([["denizlg24__web_notes", binding]]),
    builtinWrites: new Set(),
  });
  const result = streamText({
    model: options.model,
    messages: await convertToModelMessages(options.history, {
      tools: options.tools,
      ignoreIncompleteToolCalls: true,
    }),
    tools: options.tools,
    toolApproval: ({ toolCall }) =>
      policy({ toolName: toolCall.toolName, input: toolCall.input }),
  });
  let finished: AgentUIMessage[] = [];
  const stream = toUIMessageStream<ToolSet, AgentUIMessage>({
    stream: result.stream,
    tools: options.tools,
    originalMessages: options.history,
    generateMessageId: () => "assistant-1",
    onEnd: ({ messages }) => {
      finished = messages;
    },
  });
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
  return finished;
}

describe("approval round trip", () => {
  test("pauses on a write, resumes on the stored message, runs it once", async () => {
    let executions = 0;
    const tools: ToolSet = {
      denizlg24__web_notes: dynamicTool({
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => {
          executions += 1;
          return { content: [{ type: "text", text: "deleted" }] };
        },
      }),
    };
    const model = scripted([
      [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "denizlg24__web_notes",
          input: JSON.stringify({ action: "delete", id: "n1" }),
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
        },
      ],
      [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Done." },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        },
      ],
    ]);
    const user: AgentUIMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "delete n1" }],
    };

    const paused = await turn({ model, tools, history: [user] });
    const waiting = paused.at(-1);
    const toolPart = waiting?.parts.find(
      (part) => part.type === "dynamic-tool",
    );
    expect(executions).toBe(0);
    expect(toolPart).toMatchObject({ state: "approval-requested" });
    if (
      !waiting ||
      toolPart?.type !== "dynamic-tool" ||
      toolPart.state !== "approval-requested"
    ) {
      throw new Error("expected a pending approval");
    }

    const answered: AgentUIMessage = {
      ...waiting,
      parts: waiting.parts.map((part) =>
        part === toolPart
          ? {
              ...toolPart,
              state: "approval-responded",
              approval: { id: toolPart.approval.id, approved: true },
            }
          : part,
      ),
    };
    const resumed = await turn({
      model,
      tools,
      history: applyClientDecisions(paused, answered),
    });

    expect(executions).toBe(1);
    expect(resumed).toHaveLength(2);
    const final = resumed.at(-1);
    expect(final?.id).toBe(waiting.id);
    expect(
      final?.parts.find((part) => part.type === "dynamic-tool"),
    ).toMatchObject({
      state: "output-available",
      output: { content: [{ type: "text", text: "deleted" }] },
    });
    expect(
      final?.parts.some(
        (part) => part.type === "text" && part.text === "Done.",
      ),
    ).toBe(true);
  });

  test("a page tool waits for the client and resumes with its output", async () => {
    const tools: ToolSet = {
      navigate_desktop: dynamicTool({
        inputSchema: jsonSchema({ type: "object", properties: {} }),
      }),
    };
    const model = scripted([
      [
        {
          type: "tool-call",
          toolCallId: "call_3",
          toolName: "navigate_desktop",
          input: JSON.stringify({ path: "/dashboard/notes" }),
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
        },
      ],
      [
        { type: "text-start", id: "t2" },
        { type: "text-delta", id: "t2", delta: "Opened notes." },
        { type: "text-end", id: "t2" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        },
      ],
    ]);
    const paused = await turn({
      model,
      tools,
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
      ],
    });
    const waiting = paused.at(-1);
    const call = waiting?.parts.find((part) => part.type === "dynamic-tool");
    expect(call).toMatchObject({ state: "input-available" });
    if (
      !waiting ||
      call?.type !== "dynamic-tool" ||
      call.state !== "input-available"
    ) {
      throw new Error("expected a pending page tool");
    }
    const resumed = await turn({
      model,
      tools,
      history: applyClientDecisions(paused, {
        ...waiting,
        parts: [{ ...call, state: "output-available", output: { ok: true } }],
      }),
    });
    const final = resumed.at(-1);
    expect(final?.id).toBe(waiting.id);
    expect(
      final?.parts.find((part) => part.type === "dynamic-tool"),
    ).toMatchObject({
      state: "output-available",
      output: { ok: true },
    });
    expect(
      final?.parts.some(
        (part) => part.type === "text" && part.text === "Opened notes.",
      ),
    ).toBe(true);
  });

  test("a read action runs without asking", async () => {
    let executions = 0;
    const tools: ToolSet = {
      denizlg24__web_notes: dynamicTool({
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => {
          executions += 1;
          return { content: [{ type: "text", text: "[]" }] };
        },
      }),
    };
    const model = scripted([
      [
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "denizlg24__web_notes",
          input: JSON.stringify({ action: "list" }),
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
        },
      ],
    ]);
    const messages = await turn({
      model,
      tools,
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "list" }] },
      ],
    });
    expect(executions).toBe(1);
    expect(
      messages.at(-1)?.parts.find((part) => part.type === "dynamic-tool"),
    ).toMatchObject({
      state: "output-available",
    });
  });
});
