import type { AgentUIMessage } from "@repo/schemas";
import { getToolLabel } from "@repo/schemas";
import {
  type AgentToolPart,
  isToolPart,
  toolPartName,
} from "@repo/utils/agent-stream";

/** Connector tools arrive as `<slug>__<tool>`; the label is the tool's own. */
export function toolLabel(part: AgentToolPart) {
  const name = toolPartName(part);
  const bare = name.includes("__") ? (name.split("__").pop() ?? name) : name;
  const action =
    typeof part.input === "object" &&
    part.input !== null &&
    "action" in part.input &&
    typeof part.input.action === "string"
      ? part.input.action
      : null;
  return action ? `${getToolLabel(bare)} · ${action}` : getToolLabel(bare);
}

export type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; label: string; state: AgentToolPart["state"] }
  | { kind: "notice"; key: string; text: string }
  | { kind: "file"; key: string; url: string; mediaType: string };

/** What the thread draws for one message: words, one line per tool, notices. */
export function blocksOf(message: AgentUIMessage): Block[] {
  const blocks: Block[] = [];
  message.parts.forEach((part, index) => {
    const key = `${message.id}:${index}`;
    if (part.type === "text") {
      if (part.text.trim()) blocks.push({ kind: "text", key, text: part.text });
    } else if (isToolPart(part)) {
      blocks.push({
        kind: "tool",
        key: part.toolCallId || key,
        label: toolLabel(part),
        state: part.state,
      });
    } else if (part.type === "data-notice") {
      blocks.push({ kind: "notice", key, text: part.data.text });
    } else if (part.type === "file") {
      blocks.push({
        kind: "file",
        key,
        url: part.url,
        mediaType: part.mediaType,
      });
    }
  });
  return blocks;
}

/** A tool call's input as a few readable lines, for the approval prompt. */
export function describeInput(input: unknown, limit = 600): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object") return String(input).slice(0, limit);
  const lines = Object.entries(input)
    .filter(([key]) => key !== "action")
    .map(([key, value]) => {
      const text =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "");
      return `${key}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`;
    });
  const joined = lines.join("\n");
  return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
}
