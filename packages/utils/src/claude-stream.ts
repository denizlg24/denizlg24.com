import type { AgentUIMessage, AgentUIMessagePart } from "@repo/schemas";

/**
 * Claude Code's `--output-format stream-json --verbose` as AgentUIMessages,
 * so the run view renders a coding run with the same components as a chat.
 *
 * One UI message per API message (`message.id`): Claude Code emits each
 * content block of a message as its own `assistant` line sharing that id, and
 * a later `user` line carries the results for the tool calls in it. A tool
 * result therefore rewrites the step message holding its call, and `takeDirty`
 * returns every message touched since it was last called.
 */

export interface ClaudeStreamUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ClaudeStreamResult {
  subtype: string;
  isError: boolean;
  text: string;
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  usage: ClaudeStreamUsage;
  terminalReason?: string;
}

export interface ClaudeStreamInit {
  model: string;
  cwd: string;
  version: string;
  permissionMode: string;
  toolCount: number;
  sessionId: string;
}

export interface ClaudeStreamMapperOptions {
  /** Tool outputs longer than this are cut, with a note saying by how much. */
  maxToolOutputChars: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text") return asString(block.text);
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

export function truncateToolOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.length - max;
  return `${text.slice(0, max)}\n… [${cut.toLocaleString("en-US")} more characters cut]`;
}

export class ClaudeStreamMapper {
  private readonly messages: AgentUIMessage[] = [];
  private readonly indexById = new Map<string, number>();
  private readonly toolOwner = new Map<string, string>();
  private readonly dirty = new Set<string>();
  private buffer = "";
  private noticeCount = 0;
  private finalResult: ClaudeStreamResult | null = null;
  private initInfo: ClaudeStreamInit | null = null;
  private malformedLines = 0;
  private retryState: {
    status: number;
    error: string;
    attempt: number;
  } | null = null;

  constructor(private readonly options: ClaudeStreamMapperOptions) {}

  /** Feed raw stdout; partial lines are held until their newline arrives. */
  push(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  /**
   * End of stream. A last line without its newline is parsed if it is whole
   * JSON; otherwise the process died mid-write and the transcript says so.
   */
  end(): void {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return;
    if (!this.line(rest)) {
      this.notice("warning", "The stream ended in the middle of an event.");
    }
  }

  /** Apply one stream-json line. Returns false when it was not JSON. */
  line(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) return true;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      this.malformedLines += 1;
      return false;
    }
    if (isRecord(event)) this.apply(event);
    return true;
  }

  takeDirty(): AgentUIMessage[] {
    const touched = this.messages.filter((message) =>
      this.dirty.has(message.id),
    );
    this.dirty.clear();
    return touched.map((message) => ({
      ...message,
      parts: [...message.parts],
    }));
  }

  all(): AgentUIMessage[] {
    return this.messages.map((message) => ({
      ...message,
      parts: [...message.parts],
    }));
  }

  result(): ClaudeStreamResult | null {
    return this.finalResult;
  }

  init(): ClaudeStreamInit | null {
    return this.initInfo;
  }

  malformed(): number {
    return this.malformedLines;
  }

  /** A runner-side note in the transcript (timeout, cancel, push failure). */
  notice(level: "info" | "warning", text: string): void {
    this.noticeCount += 1;
    const id = `notice-${this.noticeCount}`;
    this.upsert({
      id,
      role: "assistant",
      parts: [{ type: "data-notice", data: { level, text } }],
    });
  }

  private apply(event: JsonRecord): void {
    switch (event.type) {
      case "system":
        if (event.subtype === "init") this.applyInit(event);
        else if (event.subtype === "api_retry") this.applyRetry(event);
        return;
      case "assistant":
        this.applyAssistant(event);
        return;
      case "user":
        this.applyUser(event);
        return;
      case "result":
        this.applyResult(event);
        return;
      case "rate_limit_event": {
        const info = isRecord(event.rate_limit_info)
          ? event.rate_limit_info
          : null;
        if (info && info.status !== "allowed") {
          this.notice(
            "warning",
            `Rate limit ${asString(info.rateLimitType) || "window"}: ${asString(info.status)}`,
          );
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Claude Code retries a failing API call up to `max_retries` times with
   * backoff and writes nothing else meanwhile; a rejected credential (401 from
   * the Gateway) spends minutes there before any result. One notice, rewritten
   * per attempt, so the transcript says why it is quiet.
   */
  private applyRetry(event: JsonRecord): void {
    const status = asNumber(event.error_status);
    const error = asString(event.error) || "error";
    const attempt = asNumber(event.attempt);
    const max = asNumber(event.max_retries);
    this.retryState = { status, error, attempt };
    this.upsert({
      id: "api-retry",
      role: "assistant",
      parts: [
        {
          type: "data-notice",
          data: {
            level: "warning",
            text: `API call failing (${status || "no status"} ${error}); retry ${attempt}${max ? ` of ${max}` : ""}`,
          },
        },
      ],
    });
  }

  /** The last retry Claude Code reported, if it is retrying at all. */
  retrying(): { status: number; error: string; attempt: number } | null {
    return this.retryState;
  }

  private applyInit(event: JsonRecord): void {
    const tools = Array.isArray(event.tools) ? event.tools.length : 0;
    this.initInfo = {
      model: asString(event.model),
      cwd: asString(event.cwd),
      version: asString(event.claude_code_version),
      permissionMode: asString(event.permissionMode),
      toolCount: tools,
      sessionId: asString(event.session_id),
    };
    const parts = [
      this.initInfo.version && `Claude Code ${this.initInfo.version}`,
      this.initInfo.model,
      this.initInfo.permissionMode,
      `${tools} tools`,
      this.initInfo.cwd,
    ].filter(Boolean);
    this.upsert({
      id: "init",
      role: "assistant",
      parts: [
        {
          type: "data-notice",
          data: { level: "info", text: parts.join(" · ") },
        },
      ],
    });
  }

  private ensureStep(id: string, model: string): AgentUIMessage {
    const index = this.indexById.get(id);
    const existing = index === undefined ? undefined : this.messages[index];
    if (existing) return existing;
    const message: AgentUIMessage = {
      id,
      role: "assistant",
      parts: [{ type: "step-start" }],
      ...(model && model !== "<synthetic>" ? { metadata: { model } } : {}),
    };
    this.upsert(message);
    return message;
  }

  private applyAssistant(event: JsonRecord): void {
    const message = isRecord(event.message) ? event.message : null;
    if (!message) return;
    const content = Array.isArray(message.content) ? message.content : [];
    const id = asString(message.id) || `step-${this.messages.length}`;
    const step = this.ensureStep(id, asString(message.model));
    const subagent = asString(event.parent_tool_use_id);

    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text") {
        const text = asString(block.text);
        if (text) step.parts.push({ type: "text", text, state: "done" });
      } else if (block.type === "thinking") {
        const text = asString(block.thinking);
        if (text) step.parts.push({ type: "reasoning", text, state: "done" });
      } else if (block.type === "tool_use") {
        const toolCallId = asString(block.id);
        if (!toolCallId) continue;
        step.parts.push({
          type: "dynamic-tool",
          toolName: asString(block.name) || "tool",
          toolCallId,
          state: "input-available",
          input: block.input ?? {},
          ...(subagent ? { title: "subagent" } : {}),
        });
        this.toolOwner.set(toolCallId, step.id);
      }
    }
    this.dirty.add(step.id);
  }

  private applyUser(event: JsonRecord): void {
    const message = isRecord(event.message) ? event.message : null;
    if (!message || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      const toolCallId = asString(block.tool_use_id);
      const ownerId = this.toolOwner.get(toolCallId);
      if (!ownerId) continue;
      const index = this.indexById.get(ownerId);
      const owner = index === undefined ? undefined : this.messages[index];
      if (!owner) continue;
      const partIndex = owner.parts.findIndex(
        (part) =>
          part.type === "dynamic-tool" && part.toolCallId === toolCallId,
      );
      const part = owner.parts[partIndex];
      if (!part || part.type !== "dynamic-tool") continue;
      const text = truncateToolOutput(
        toolResultText(block.content),
        this.options.maxToolOutputChars,
      );
      const base = {
        type: "dynamic-tool" as const,
        toolName: part.toolName,
        toolCallId,
        input: part.input,
        ...(part.title ? { title: part.title } : {}),
      };
      const next: AgentUIMessagePart =
        block.is_error === true
          ? { ...base, state: "output-error", errorText: text || "Tool error" }
          : { ...base, state: "output-available", output: text };
      owner.parts[partIndex] = next;
      this.dirty.add(owner.id);
    }
  }

  private applyResult(event: JsonRecord): void {
    const usage = isRecord(event.usage) ? event.usage : {};
    this.finalResult = {
      subtype: asString(event.subtype),
      isError: event.is_error === true,
      text: asString(event.result),
      numTurns: asNumber(event.num_turns),
      durationMs: asNumber(event.duration_ms),
      totalCostUsd: asNumber(event.total_cost_usd),
      usage: {
        inputTokens: asNumber(usage.input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        cacheReadTokens: asNumber(usage.cache_read_input_tokens),
        cacheWriteTokens: asNumber(usage.cache_creation_input_tokens),
      },
      ...(typeof event.terminal_reason === "string"
        ? { terminalReason: event.terminal_reason }
        : {}),
    };
    if (this.finalResult.isError) {
      this.notice(
        "warning",
        this.finalResult.text ||
          `Claude Code ended with ${this.finalResult.subtype || "an error"}`,
      );
    }
  }

  private upsert(message: AgentUIMessage): void {
    const index = this.indexById.get(message.id);
    if (index === undefined) {
      this.indexById.set(message.id, this.messages.length);
      this.messages.push(message);
    } else {
      this.messages[index] = message;
    }
    this.dirty.add(message.id);
  }
}

/**
 * Applies a batch of upserted messages to a stored transcript and bounds it:
 * past `maxParts`, the oldest step messages go and one notice says how many.
 * The first message (the run's request) is always kept.
 */
export function mergeTranscript(
  stored: readonly AgentUIMessage[],
  upserts: readonly AgentUIMessage[],
  maxParts: number,
): AgentUIMessage[] {
  const messages = [...stored];
  const index = new Map(messages.map((message, i) => [message.id, i]));
  for (const message of upserts) {
    const at = index.get(message.id);
    if (at === undefined) {
      index.set(message.id, messages.length);
      messages.push(message);
    } else {
      messages[at] = message;
    }
  }

  const count = (list: readonly AgentUIMessage[]) =>
    list.reduce((sum, message) => sum + message.parts.length, 0);
  if (count(messages) <= maxParts) return messages;

  const head = messages[0]?.role === "user" ? [messages[0]] : [];
  const trimmedNoticeId = "trimmed";
  let body = messages
    .slice(head.length)
    .filter((message) => message.id !== trimmedNoticeId);
  let dropped = 0;
  const previous = messages.find((message) => message.id === trimmedNoticeId);
  const previousPart = previous?.parts[0];
  if (previousPart?.type === "data-notice") {
    const match = /^(\d+)/.exec(previousPart.data.text);
    dropped = match ? Number(match[1]) : 0;
  }
  while (body.length > 1 && count(head) + count(body) + 1 > maxParts) {
    dropped += 1;
    body = body.slice(1);
  }
  const notice: AgentUIMessage = {
    id: trimmedNoticeId,
    role: "assistant",
    parts: [
      {
        type: "data-notice",
        data: {
          level: "info",
          text: `${dropped} earlier steps trimmed from this transcript.`,
        },
      },
    ],
  };
  return [...head, notice, ...body];
}
