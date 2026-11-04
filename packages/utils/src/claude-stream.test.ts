import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentUIMessage } from "@repo/schemas";
import { ClaudeStreamMapper, mergeTranscript } from "./claude-stream";

/**
 * Captured from Claude Code 2.1.317 (`claude -p … --output-format stream-json
 * --verbose`), with paths rewritten to /work and signatures shortened.
 */
const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

function toolParts(messages: AgentUIMessage[]) {
  return messages.flatMap((message) =>
    message.parts.filter((part) => part.type === "dynamic-tool"),
  );
}

describe("ClaudeStreamMapper on a real stream", () => {
  const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 16_000 });
  mapper.push(fixture("claude-stream.jsonl"));
  mapper.end();
  const messages = mapper.all();

  test("init becomes a notice naming the model", () => {
    const init = messages.find((message) => message.id === "init");
    const part = init?.parts[0];
    expect(part?.type).toBe("data-notice");
    if (part?.type === "data-notice") {
      expect(part.data.text).toContain("claude-haiku-5-5");
      expect(part.data.text).toContain("2.1.317");
    }
    expect(mapper.init()?.permissionMode).toBe("bypassPermissions");
  });

  test("blocks sharing a message id land in one step", () => {
    const steps = messages.filter((message) => message.id.startsWith("msg_"));
    expect(steps).toHaveLength(4);
    for (const step of steps) expect(step.parts[0]?.type).toBe("step-start");
  });

  test("redacted thinking adds no empty reasoning part", () => {
    const reasoning = messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "reasoning"),
    );
    expect(reasoning).toHaveLength(0);
  });

  test("tool results resolve their calls, errors included", () => {
    const tools = toolParts(messages);
    expect(tools.map((part) => [part.toolName, part.state])).toEqual([
      ["Bash", "output-available"],
      ["Read", "output-error"],
      ["Write", "output-available"],
    ]);
    const bash = tools[0];
    if (bash?.state === "output-available") expect(bash.output).toBe("hello");
    const read = tools[1];
    if (read?.state === "output-error") {
      expect(read.errorText).toContain("File does not exist");
    }
  });

  test("the closing text is the last step's text", () => {
    const last = messages.at(-1);
    expect(last?.parts.at(-1)).toMatchObject({ type: "text" });
  });

  test("result carries cost, usage and turns", () => {
    const result = mapper.result();
    expect(result?.isError).toBe(false);
    expect(result?.totalCostUsd).toBeCloseTo(0.00241973, 8);
    expect(result?.usage.cacheReadTokens).toBe(67_613);
    expect(result?.usage.cacheWriteTokens).toBe(7_244);
    expect(result?.numTurns).toBeGreaterThan(0);
  });
});

describe("ClaudeStreamMapper edge cases", () => {
  test("a rejected Gateway credential retries loudly, as one notice", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 100 });
    mapper.push(fixture("claude-gateway-auth-retry.jsonl"));
    mapper.end();
    expect(mapper.retrying()).toMatchObject({
      status: 401,
      error: "authentication_failed",
      attempt: 9,
    });
    const notices = mapper
      .all()
      .filter((message) => message.id === "api-retry");
    expect(notices).toHaveLength(1);
    const part = notices[0]?.parts[0];
    if (part?.type === "data-notice") {
      expect(part.data.text).toContain("401 authentication_failed");
      expect(part.data.text).toContain("retry 9 of 10");
    }
    expect(mapper.result()).toBeNull();
  });

  test("an error result with subtype success is still an error", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 100 });
    mapper.push(fixture("claude-auth-error.jsonl"));
    mapper.end();
    expect(mapper.result()?.isError).toBe(true);
    expect(mapper.result()?.subtype).toBe("success");
    const notices = mapper
      .all()
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "data-notice");
    expect(
      notices.some(
        (part) =>
          part.type === "data-notice" && part.data.text.includes("/login"),
      ),
    ).toBe(true);
  });

  test("lines split across reads are reassembled", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 100 });
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        model: "m",
        content: [{ type: "text", text: "hi" }],
      },
    });
    mapper.push(line.slice(0, 10));
    expect(mapper.all()).toHaveLength(0);
    mapper.push(`${line.slice(10)}\n`);
    expect(mapper.all()[0]?.parts.at(-1)).toMatchObject({
      type: "text",
      text: "hi",
    });
  });

  test("a truncated last line becomes a notice, not a crash", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 100 });
    mapper.push('{"type":"assistant","message":{"id":"msg_1"');
    mapper.end();
    const part = mapper.all()[0]?.parts[0];
    expect(part?.type).toBe("data-notice");
  });

  test("thinking with text becomes reasoning", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 100 });
    mapper.line(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          content: [{ type: "thinking", thinking: "plan", signature: "s" }],
        },
      }),
    );
    expect(mapper.all()[0]?.parts[1]).toMatchObject({
      type: "reasoning",
      text: "plan",
    });
  });

  test("long tool output is cut with a note, array content is joined", () => {
    const mapper = new ClaudeStreamMapper({ maxToolOutputChars: 10 });
    mapper.line(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
        },
      }),
    );
    mapper.takeDirty();
    mapper.line(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "text", text: "0123456789abcdef" },
                { type: "image" },
              ],
            },
          ],
        },
      }),
    );
    const dirty = mapper.takeDirty();
    expect(dirty.map((message) => message.id)).toEqual(["msg_1"]);
    const part = dirty[0]?.parts[1];
    expect(part?.type === "dynamic-tool" && part.state).toBe(
      "output-available",
    );
    if (part?.type === "dynamic-tool" && part.state === "output-available") {
      expect(String(part.output)).toStartWith("0123456789\n…");
      expect(String(part.output)).toContain("more characters cut");
    }
    expect(mapper.takeDirty()).toHaveLength(0);
  });
});

describe("mergeTranscript", () => {
  const step = (id: string, parts = 2): AgentUIMessage => ({
    id,
    role: "assistant",
    parts: Array.from({ length: parts }, () => ({
      type: "text" as const,
      text: id,
    })),
  });
  const request: AgentUIMessage = {
    id: "request",
    role: "user",
    parts: [{ type: "text", text: "do it" }],
  };

  test("upserts replace in place and append new ids", () => {
    const merged = mergeTranscript(
      [request, step("a"), step("b")],
      [step("a", 3), step("c")],
      100,
    );
    expect(merged.map((m) => m.id)).toEqual(["request", "a", "b", "c"]);
    expect(merged[1]?.parts).toHaveLength(3);
  });

  test("past the cap, the oldest steps go and the request stays", () => {
    let transcript: AgentUIMessage[] = [request];
    for (let i = 0; i < 10; i += 1) {
      transcript = mergeTranscript(transcript, [step(`s${i}`)], 10);
    }
    const parts = transcript.reduce((n, m) => n + m.parts.length, 0);
    expect(parts).toBeLessThanOrEqual(10);
    expect(transcript[0]?.id).toBe("request");
    expect(transcript[1]?.id).toBe("trimmed");
    expect(transcript.at(-1)?.id).toBe("s9");
    const notice = transcript[1]?.parts[0];
    if (notice?.type === "data-notice") {
      expect(notice.data.text).toStartWith("6 earlier steps");
    }
  });
});
