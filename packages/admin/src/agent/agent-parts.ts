import {
  type AgentUIMessage,
  type AgentUIMessagePart,
  type AgentUsage,
  getToolLabel,
  isAgentPageTool,
  PRIMARY_CONNECTOR_SLUG,
} from "@repo/schemas";
import {
  type DynamicToolUIPart,
  type FileUIPart,
  isToolUIPart,
  type LanguageModelUsage,
  type SourceUrlUIPart,
  type ToolUIPart,
} from "ai";

export type AgentToolPart = ToolUIPart | DynamicToolUIPart;

/** Provider-executed search tools; their results arrive as `source-url` parts. */
const WEB_TOOLS = new Set(["web_search", "web_fetch"]);

/** Tool-name prefixes the primary MCP server groups its catalogue by. */
const PRIMARY_DOMAIN_PREFIX = /^(web|forge|cloud|storage)_/;

export function isAgentToolPart(
  part: AgentUIMessagePart,
): part is Extract<AgentUIMessagePart, AgentToolPart> {
  return isToolUIPart(part);
}

export function toolPartName(part: AgentToolPart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
}

export function isPageToolPart(part: AgentUIMessagePart): boolean {
  return isAgentToolPart(part) && isAgentPageTool(toolPartName(part));
}

export function isWebToolPart(part: AgentToolPart): boolean {
  return part.providerExecuted === true && WEB_TOOLS.has(toolPartName(part));
}

function metadataString(
  part: AgentToolPart,
  key: "connector" | "connectorName" | "toolName" | "title",
): string | undefined {
  const value = part.toolMetadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function inputAction(part: AgentToolPart): string | undefined {
  const input = part.input;
  if (typeof input !== "object" || input === null || !("action" in input)) {
    return undefined;
  }
  return typeof input.action === "string" ? input.action : undefined;
}

function humanize(name: string): string {
  const words = name
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

/** "Notes · list" for an action tool, a sentence-cased name otherwise. */
export function toolTitle(part: AgentToolPart): string {
  const action = inputAction(part);
  let base: string;
  if (part.type === "dynamic-tool") {
    const connector = metadataString(part, "connector");
    const raw =
      metadataString(part, "toolName") ??
      part.toolName.split("__").at(-1) ??
      part.toolName;
    base =
      metadataString(part, "title") ??
      humanize(
        connector === PRIMARY_CONNECTOR_SLUG
          ? raw.replace(PRIMARY_DOMAIN_PREFIX, "")
          : raw,
      );
  } else {
    base = part.title ?? getToolLabel(toolPartName(part));
  }
  return action ? `${base} · ${action}` : base;
}

export function toolProvenance(part: AgentToolPart): string | undefined {
  if (part.type === "dynamic-tool") {
    return (
      metadataString(part, "connectorName") ?? metadataString(part, "connector")
    );
  }
  const input = part.input;
  if (
    toolPartName(part) === "navigate_desktop" &&
    typeof input === "object" &&
    input !== null &&
    "path" in input &&
    typeof input.path === "string"
  ) {
    return input.path;
  }
  return undefined;
}

type ConnectorContent =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string };

/** Connector results carry MCP `content`; anything else is shown as JSON. */
export function connectorContent(output: unknown): ConnectorContent[] | null {
  if (
    typeof output !== "object" ||
    output === null ||
    !("content" in output) ||
    !Array.isArray(output.content)
  ) {
    return null;
  }
  const blocks: ConnectorContent[] = [];
  for (const block of output.content) {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      continue;
    }
    if (
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      blocks.push({ kind: "text", text: block.text });
    } else if (
      block.type === "image" &&
      "url" in block &&
      typeof block.url === "string"
    ) {
      blocks.push({ kind: "image", src: block.url });
    } else if (
      block.type === "image" &&
      "data" in block &&
      typeof block.data === "string" &&
      "mimeType" in block &&
      typeof block.mimeType === "string"
    ) {
      blocks.push({
        kind: "image",
        src: `data:${block.mimeType};base64,${block.data}`,
      });
    }
  }
  return blocks;
}

function lastStepParts(message: AgentUIMessage): AgentUIMessagePart[] {
  let start = -1;
  message.parts.forEach((part, index) => {
    if (part.type === "step-start") start = index;
  });
  return message.parts.slice(start + 1);
}

/**
 * Resubmit once the client has answered everything the stored turn waits on.
 * Only the last step counts: an answered page tool stays `output-available`
 * forever, and reading the whole message would resubmit after every turn.
 */
export function shouldContinueAgentTurn({
  messages,
}: {
  messages: AgentUIMessage[];
}): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  const tools = lastStepParts(last).filter(isAgentToolPart);
  if (tools.some((part) => part.state === "approval-requested")) return false;
  if (
    tools.some(
      (part) =>
        isPageToolPart(part) &&
        (part.state === "input-streaming" || part.state === "input-available"),
    )
  ) {
    return false;
  }
  return tools.some(
    (part) =>
      (part.state === "approval-responded" && !part.approval.isAutomatic) ||
      (isPageToolPart(part) &&
        (part.state === "output-available" || part.state === "output-error")),
  );
}

/** True while the last assistant message still has something only the client can answer. */
export function awaitsClient(messages: AgentUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  return lastStepParts(last)
    .filter(isAgentToolPart)
    .some(
      (part) =>
        (part.state === "approval-requested" && !part.approval.isAutomatic) ||
        (isPageToolPart(part) && part.state === "input-available"),
    );
}

export function messageText(message: Pick<AgentUIMessage, "parts">): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

export type AgentBlock =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; text: string; streaming: boolean }
  | { kind: "tool"; key: string; part: AgentToolPart }
  | { kind: "web"; key: string; part: AgentToolPart }
  | { kind: "sources"; key: string; sources: SourceUrlUIPart[] }
  | { kind: "notice"; key: string; level: "info" | "warning"; text: string }
  | { kind: "file"; key: string; part: FileUIPart }
  | { kind: "divider"; key: string };

/**
 * Flattens a message into what the transcript draws. Sources are collected per
 * step and placed after the step's last web tool (or at the step's end), and
 * a step boundary only becomes a hairline when two text blocks would touch.
 */
export function buildAgentBlocks(message: AgentUIMessage): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  let stepSources: SourceUrlUIPart[] = [];
  let sourcesAnchor = -1;
  let boundary = false;
  let step = 0;

  const flushSources = () => {
    if (stepSources.length === 0) return;
    const block: AgentBlock = {
      kind: "sources",
      key: `sources-${step}`,
      sources: stepSources,
    };
    if (sourcesAnchor >= 0) blocks.splice(sourcesAnchor + 1, 0, block);
    else blocks.push(block);
    stepSources = [];
    sourcesAnchor = -1;
  };

  const push = (block: AgentBlock) => {
    if (boundary && block.kind === "text" && blocks.at(-1)?.kind === "text") {
      blocks.push({ kind: "divider", key: `divider-${block.key}` });
    }
    boundary = false;
    blocks.push(block);
  };

  message.parts.forEach((part, index) => {
    const key = `${message.id}-${index}`;
    if (part.type === "step-start") {
      flushSources();
      step += 1;
      boundary = true;
      return;
    }
    if (part.type === "text") {
      if (part.text.trim()) {
        push({
          kind: "text",
          key,
          text: part.text,
          streaming: part.state === "streaming",
        });
      }
      return;
    }
    if (part.type === "reasoning") {
      if (part.text.trim() || part.state === "streaming") {
        push({
          kind: "reasoning",
          key,
          text: part.text,
          streaming: part.state === "streaming",
        });
      }
      return;
    }
    if (part.type === "source-url") {
      if (!stepSources.some((source) => source.url === part.url)) {
        stepSources.push(part);
      }
      return;
    }
    if (part.type === "file") {
      push({ kind: "file", key, part });
      return;
    }
    if (part.type === "data-notice") {
      push({
        kind: "notice",
        key,
        level: part.data.level,
        text: part.data.text,
      });
      return;
    }
    if (isAgentToolPart(part)) {
      const web = isWebToolPart(part);
      push({ kind: web ? "web" : "tool", key: part.toolCallId, part });
      if (web) sourcesAnchor = blocks.length - 1;
    }
  });
  flushSources();
  return blocks;
}

const compact = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

export function formatTokenCount(tokens: number): string {
  return compact.format(tokens);
}

export function formatCost(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

export function toLanguageModelUsage(usage: AgentUsage): LanguageModelUsage {
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: usage.reasoningTokens,
    },
    totalTokens: usage.inputTokens + usage.outputTokens,
  };
}

/** The part of a gateway id after the provider, e.g. `claude-sonnet-4.6`. */
export function shortModelName(model: string): string {
  return model.split("/").at(-1) ?? model;
}
