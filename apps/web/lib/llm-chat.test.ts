import { beforeEach, describe, expect, mock, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";

// Characterization tests for the agent loop. They pin the SSE event contract,
// tool ordering/approval invariants, and persisted content-block ordering.
// All transport/usage seams are injected so the tests are independent of the
// actual LLM provider wiring.

const readExecuteMock = mock(async (input: Record<string, unknown>) => ({
  ok: true,
  echoed: input,
}));
const writeExecuteMock = mock(async () => ({ written: true }));

mock.module("@/lib/tools/registry", () => ({
  getToolByName: (name: string) => {
    if (name === "read_tool") return { name, execute: readExecuteMock };
    if (name === "write_tool") return { name, execute: writeExecuteMock };
    if (name === "client_tool") return { name };
    return undefined;
  },
  isClientTool: (name: string) => name === "client_tool",
  isWriteTool: (name: string) => name === "write_tool",
}));

// The real @/lib/llm module loads (transport/cost/log seams are all injected
// below); it only needs credentials at import time and a mocked Mongo layer.
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.AI_GATEWAY_API_KEY ??= "test-gateway-key";
mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
mock.module("@/models/LlmUsage", () => ({
  LlmUsage: { create: async () => ({}) },
}));

const { createAgenticSSEStream } = await import("./llm-chat");
type AgentMessageStream = import("./llm-chat").AgentMessageStream;
type AgentTransport = import("./llm-chat").AgentTransport;

interface ScriptedTurn {
  text?: string;
  toolUses?: { id: string; name: string; input: Record<string, unknown> }[];
  stopReason?: string;
}

function fakeMessage(turn: ScriptedTurn): Anthropic.Message {
  const content: unknown[] = [];
  if (turn.text) content.push({ type: "text", text: turn.text });
  for (const tu of turn.toolUses ?? []) {
    content.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    });
  }
  return {
    content,
    stop_reason:
      turn.stopReason ?? (turn.toolUses?.length ? "tool_use" : "end_turn"),
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

function fakeStream(
  turn: ScriptedTurn,
): AgentMessageStream & { aborted: boolean } {
  const events: unknown[] = [];
  if (turn.text) {
    events.push({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: turn.text },
    });
  }
  (turn.toolUses ?? []).forEach((tu, i) => {
    events.push({
      type: "content_block_start",
      index: i + 1,
      content_block: { type: "tool_use", id: tu.id, name: tu.name, input: {} },
    });
    events.push({
      type: "content_block_delta",
      index: i + 1,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(tu.input),
      },
    });
  });

  return {
    aborted: false,
    async emitted() {},
    async finalMessage() {
      return fakeMessage(turn);
    },
    abort() {
      this.aborted = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event as Anthropic.MessageStreamEvent;
      }
    },
  };
}

function scriptedTransport(turns: ScriptedTurn[]): AgentTransport & {
  calls: Anthropic.MessageStreamParams[];
  streams: (AgentMessageStream & { aborted: boolean })[];
} {
  const calls: Anthropic.MessageStreamParams[] = [];
  const streams: (AgentMessageStream & { aborted: boolean })[] = [];
  return {
    calls,
    streams,
    streamMessages(params) {
      // Snapshot: the loop keeps mutating the same messages array afterwards.
      calls.push(structuredClone(params));
      const turn = turns.shift();
      if (!turn) throw new Error("No scripted turn left");
      const stream = fakeStream(turn);
      streams.push(stream);
      return stream;
    },
  };
}

async function collectEvents(
  stream: ReadableStream,
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
  }
  const events: Record<string, unknown>[] = [];
  for (const line of buffer.split("\n")) {
    if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
  }
  return events;
}

const baseParams = {
  system: "system prompt",
  model: "test-model",
  source: "test-source",
  maxTokens: 4096,
  useAdaptiveThinking: false,
  computeCost: () => 0.5,
};

beforeEach(() => {
  readExecuteMock.mockClear();
  writeExecuteMock.mockClear();
});

describe("createAgenticSSEStream", () => {
  test("streams text deltas and a done event for a plain response", async () => {
    const transport = scriptedTransport([{ text: "Hello there" }]);
    const logUsage = mock((_entry: Record<string, unknown>) => {});
    const persisted: Anthropic.MessageParam[][] = [];

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage,
        messages: [{ role: "user", content: "Hi" }],
        onPersist: async (msgs) => {
          persisted.push(structuredClone(msgs));
        },
      }),
    );

    expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
    expect(events[0].text).toBe("Hello there");
    const usage = events[1].usage as Record<string, unknown>;
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(5);
    expect(usage.costUsd).toBe(0.5);
    expect(usage.model).toBe("test-model");
    expect(usage.iterations).toBe(1);

    // Persisted transcript ends with the assistant turn.
    const last = persisted.at(-1);
    expect(last).toBeDefined();
    expect(last?.at(-1)?.role).toBe("assistant");
    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage.mock.calls[0]?.[0]).toMatchObject({
      llmModel: "test-model",
      source: "test-source",
      costUsd: 0.5,
    });

    // The request carried the cached system prompt and no tools.
    expect(transport.calls[0]?.system).toEqual([
      {
        type: "text",
        text: "system prompt",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  test("executes a single read tool and continues the loop", async () => {
    const transport = scriptedTransport([
      { toolUses: [{ id: "tu_1", name: "read_tool", input: { q: "x" } }] },
      { text: "Done" },
    ]);

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Look it up" }],
      }),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_start",
      "tool_input_delta",
      "tool_call_complete",
      "tool_call",
      "tool_result",
      "delta",
      "done",
    ]);
    expect(readExecuteMock).toHaveBeenCalledWith({ q: "x" });

    // Second model call got the tool_result turn as the last user message.
    const secondCall = transport.calls[1];
    const lastMessage = secondCall?.messages.at(-1);
    expect(lastMessage?.role).toBe("user");
    expect(lastMessage?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: JSON.stringify({ ok: true, echoed: { q: "x" } }),
      },
    ]);
  });

  test("runs two parallel read tools into one ordered user turn", async () => {
    const transport = scriptedTransport([
      {
        toolUses: [
          { id: "tu_a", name: "read_tool", input: { a: 1 } },
          { id: "tu_b", name: "read_tool", input: { b: 2 } },
        ],
      },
      { text: "Both done" },
    ]);

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Do both" }],
      }),
    );

    expect(readExecuteMock).toHaveBeenCalledTimes(2);
    const resultTurn = transport.calls[1]?.messages.at(-1);
    expect(resultTurn?.role).toBe("user");
    const ids = (resultTurn?.content as Anthropic.ToolResultBlockParam[]).map(
      (b) => b.tool_use_id,
    );
    expect(ids).toEqual(["tu_a", "tu_b"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  test("pauses for write tool approval and persists before pausing", async () => {
    const transport = scriptedTransport([
      { toolUses: [{ id: "tu_w", name: "write_tool", input: { v: 1 } }] },
    ]);
    const persisted: Anthropic.MessageParam[][] = [];

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Write it" }],
        onPersist: async (msgs) => {
          persisted.push(structuredClone(msgs));
        },
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_confirmation_required");
    expect(events.at(-1)).toEqual({ type: "paused", reason: "approval" });
    expect(writeExecuteMock).not.toHaveBeenCalled();
    // Assistant tool_use turn persisted before the pause.
    expect(persisted.at(-1)?.at(-1)?.role).toBe("assistant");
  });

  test("resumes with approval, executes the write tool, and continues", async () => {
    const transport = scriptedTransport([{ text: "Saved" }]);
    const priorMessages: Anthropic.MessageParam[] = [
      { role: "user", content: "Write it" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu_w", name: "write_tool", input: { v: 1 } },
        ],
      },
    ];

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage: () => {},
        messages: priorMessages,
        toolApprovals: { tu_w: true },
      }),
    );

    expect(writeExecuteMock).toHaveBeenCalledTimes(1);
    const types = events.map((e) => e.type);
    expect(types).toEqual(["tool_call", "tool_result", "delta", "done"]);
    const resultTurn = transport.calls[0]?.messages.at(-1);
    expect(resultTurn?.role).toBe("user");
    expect(resultTurn?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu_w",
        content: JSON.stringify({ written: true }),
      },
    ]);
  });

  test("resumes with denial and injects an error tool_result", async () => {
    const transport = scriptedTransport([{ text: "Understood" }]);

    const events = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport,
        logUsage: () => {},
        messages: [
          { role: "user", content: "Write it" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tu_w",
                name: "write_tool",
                input: { v: 1 },
              },
            ],
          },
        ],
        toolApprovals: { tu_w: false },
      }),
    );

    expect(writeExecuteMock).not.toHaveBeenCalled();
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.isError).toBe(true);
    expect(toolResult?.result).toBe("User denied this action.");
    const resultTurn = transport.calls[0]?.messages.at(-1);
    const block = (resultTurn?.content as Anthropic.ToolResultBlockParam[])[0];
    expect(block?.is_error).toBe(true);
  });

  test("pauses for a client tool and resumes with its result", async () => {
    const pauseTransport = scriptedTransport([
      { toolUses: [{ id: "tu_c", name: "client_tool", input: { n: 1 } }] },
    ]);

    const pauseEvents = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport: pauseTransport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Classify" }],
      }),
    );

    const pauseTypes = pauseEvents.map((e) => e.type);
    expect(pauseTypes).toContain("client_tool_required");
    expect(pauseEvents.at(-1)).toEqual({
      type: "paused",
      reason: "client_tool",
    });

    const resumeTransport = scriptedTransport([{ text: "Classified" }]);
    const resumeEvents = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport: resumeTransport,
        logUsage: () => {},
        messages: [
          { role: "user", content: "Classify" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tu_c",
                name: "client_tool",
                input: { n: 1 },
              },
            ],
          },
        ],
        clientToolResults: [{ toolUseId: "tu_c", content: '{"ok":true}' }],
      }),
    );

    const resultEvent = resumeEvents.find((e) => e.type === "tool_result");
    expect(resultEvent?.toolId).toBe("tu_c");
    expect(resumeEvents.at(-1)?.type).toBe("done");
    const resultTurn = resumeTransport.calls[0]?.messages.at(-1);
    expect(resultTurn?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_c", content: '{"ok":true}' },
    ]);
  });

  test("mixed read/write/client turn defers all execution and orders results", async () => {
    // Turn with read + write + client tools: everything defers to resume.
    const pauseTransport = scriptedTransport([
      {
        toolUses: [
          { id: "tu_r", name: "read_tool", input: { r: 1 } },
          { id: "tu_w", name: "write_tool", input: { w: 1 } },
          { id: "tu_c", name: "client_tool", input: { c: 1 } },
        ],
      },
    ]);

    const pauseEvents = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport: pauseTransport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Do all three" }],
      }),
    );

    expect(readExecuteMock).not.toHaveBeenCalled();
    expect(writeExecuteMock).not.toHaveBeenCalled();
    expect(pauseEvents.at(-1)).toEqual({ type: "paused", reason: "approval" });

    const assistantTurn: Anthropic.MessageParam = {
      role: "assistant",
      content: [
        { type: "tool_use", id: "tu_r", name: "read_tool", input: { r: 1 } },
        { type: "tool_use", id: "tu_w", name: "write_tool", input: { w: 1 } },
        { type: "tool_use", id: "tu_c", name: "client_tool", input: { c: 1 } },
      ],
    };

    // Client result arrives first — still pending write approval, so re-pause.
    const repause = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport: scriptedTransport([]),
        logUsage: () => {},
        messages: [{ role: "user", content: "Do all three" }, assistantTurn],
        clientToolResults: [{ toolUseId: "tu_c", content: "client-ok" }],
      }),
    );
    expect(repause.at(-1)).toEqual({ type: "paused", reason: "approval" });

    // Approval + carried client result completes the turn in block order.
    const resumeTransport = scriptedTransport([{ text: "All finished" }]);
    const resumeEvents = await collectEvents(
      createAgenticSSEStream({
        ...baseParams,
        transport: resumeTransport,
        logUsage: () => {},
        messages: [{ role: "user", content: "Do all three" }, assistantTurn],
        toolApprovals: { tu_w: true },
        clientToolResults: [{ toolUseId: "tu_c", content: "client-ok" }],
      }),
    );

    expect(readExecuteMock).toHaveBeenCalledTimes(1);
    expect(writeExecuteMock).toHaveBeenCalledTimes(1);
    const resultTurn = resumeTransport.calls[0]?.messages.at(-1);
    expect(resultTurn?.role).toBe("user");
    const ids = (resultTurn?.content as Anthropic.ToolResultBlockParam[]).map(
      (b) => b.tool_use_id,
    );
    expect(ids).toEqual(["tu_r", "tu_w", "tu_c"]);
    expect(resumeEvents.at(-1)?.type).toBe("done");
  });

  test("cancel aborts the active upstream stream", async () => {
    let releaseAbort: (() => void) | undefined;
    const hangingStream: AgentMessageStream & { aborted: boolean } = {
      aborted: false,
      async emitted() {},
      async finalMessage() {
        return fakeMessage({ text: "never" });
      },
      abort() {
        this.aborted = true;
        releaseAbort?.();
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "partial" },
        } as unknown as Anthropic.MessageStreamEvent;
        await new Promise<void>((resolve) => {
          releaseAbort = resolve;
        });
      },
    };

    const stream = createAgenticSSEStream({
      ...baseParams,
      transport: { streamMessages: () => hangingStream },
      logUsage: () => {},
      messages: [{ role: "user", content: "Hi" }],
    });

    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("partial");
    await reader.cancel();
    expect(hangingStream.aborted).toBe(true);
  });
});
