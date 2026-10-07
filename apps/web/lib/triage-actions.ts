import type { MCPClient } from "@ai-sdk/mcp";
import type Anthropic from "@anthropic-ai/sdk";
import type { ConnectorTool, TriageActionEffect } from "@repo/schemas";
import {
  cachedToolDefinitions,
  describeToolDefinition,
  ensurePrimaryConnector,
  type McpToolDefinition,
  openConnectorClient,
} from "@/lib/connectors/service";
import { runToolLoop } from "@/lib/llm-service";

/**
 * Tools triage may never touch, read or write. The email is untrusted, so
 * nothing it says may reach credentials, the agent's own memory and tasks,
 * outbound publishing, or mail itself. Cards and calendar events are left out
 * because task and event suggestions already own them.
 */
const DENIED_TOOL_PREFIXES = [
  "web_agent_memory",
  "web_agent_tasks",
  "web_api_keys",
  "web_authenticator",
  "web_background_agent_runs",
  "web_blogs",
  "web_calendar_events",
  "web_calendar_google",
  "web_calendar_settings",
  "web_comments",
  "web_conversations",
  "web_cv",
  "web_email_accounts",
  "web_emails",
  "web_instagram_token",
  "web_kanban_cards",
  "web_latex_agent",
  "web_llm",
  "web_markets_orders",
  "web_markets_trades",
  "web_revalidate",
  "web_settings",
  "web_triage",
  "web_upload",
] as const;

const MAX_PROPOSALS = 5;
const MAX_LOOKUPS = 8;
const MAX_DESCRIBES = 6;
const LOOKUP_RESULT_CHARS = 12_000;
const SCHEMA_CHARS = 8_000;
const RESULT_SUMMARY_CHARS = 600;

export interface TriageActionTool {
  definition: McpToolDefinition;
  meta: ConnectorTool;
}

export interface ProposedTriageAction {
  tool: string;
  action?: string;
  arguments: Record<string, unknown>;
  summary: string;
  effect: TriageActionEffect;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTriageActionToolName(name: string): boolean {
  return (
    name.startsWith("web_") &&
    !DENIED_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** The primary connector's tools triage is allowed to read and propose writes to. */
export function selectTriageActionTools(
  definitions: readonly McpToolDefinition[],
  disabled: ReadonlySet<string> = new Set(),
): Map<string, TriageActionTool> {
  const tools = new Map<string, TriageActionTool>();
  for (const definition of definitions) {
    if (disabled.has(definition.name)) continue;
    if (!isTriageActionToolName(definition.name)) continue;
    tools.set(definition.name, {
      definition,
      meta: describeToolDefinition(definition),
    });
  }
  return tools;
}

function chosenAction(input: Record<string, unknown>): string | undefined {
  return typeof input.action === "string" ? input.action : undefined;
}

/** Same rule the agent's approval policy applies: per action when the tool has actions. */
export function isReadOnlyTriageCall(
  tool: TriageActionTool,
  input: Record<string, unknown>,
): boolean {
  const action = chosenAction(input);
  if (tool.meta.actions) {
    return action !== undefined && tool.meta.actions[action]?.readOnly === true;
  }
  return tool.meta.readOnly;
}

function isDestructiveTriageCall(
  tool: TriageActionTool,
  input: Record<string, unknown>,
): boolean {
  const action = chosenAction(input);
  if (tool.meta.actions && action) {
    return tool.meta.actions[action]?.destructive === true;
  }
  return tool.meta.destructive;
}

function firstLine(text: string | undefined, limit: number): string {
  const line = (text ?? "").split("\n")[0]?.trim() ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export function formatTriageToolCatalogue(
  tools: ReadonlyMap<string, TriageActionTool>,
): string {
  const lines: string[] = [];
  for (const [name, tool] of tools) {
    const description = firstLine(
      tool.definition.description ?? tool.meta.title,
      140,
    );
    const actions = tool.meta.actions;
    if (actions) {
      const reads = Object.entries(actions)
        .filter(([, flags]) => flags.readOnly)
        .map(([action]) => action);
      const writes = Object.entries(actions)
        .filter(([, flags]) => !flags.readOnly)
        .map(([action]) => action);
      lines.push(
        `- ${name}: ${description} [reads: ${reads.join(", ") || "none"}; writes: ${writes.join(", ") || "none"}]`,
      );
    } else {
      lines.push(
        `- ${name}: ${description} [${tool.meta.readOnly ? "read" : "write"}]`,
      );
    }
  }
  return lines.join("\n");
}

function inferEffect(
  tool: TriageActionTool,
  input: Record<string, unknown>,
  stated: unknown,
): TriageActionEffect {
  if (isDestructiveTriageCall(tool, input)) return "delete";
  if (stated === "create" || stated === "update" || stated === "delete") {
    return stated;
  }
  const action = chosenAction(input) ?? "";
  if (/^(create|add|new)/.test(action)) return "create";
  if (/^(delete|remove|archive)/.test(action)) return "delete";
  return "update";
}

/**
 * Keeps only proposals that name an allowed tool, choose one of its write
 * actions, and carry an argument object. Anything else is dropped rather than
 * stored as a button that fails when pressed.
 */
export function validateTriageProposals(
  raw: unknown,
  tools: ReadonlyMap<string, TriageActionTool>,
): ProposedTriageAction[] {
  if (!Array.isArray(raw)) return [];
  const proposals: ProposedTriageAction[] = [];
  for (const entry of raw) {
    if (proposals.length >= MAX_PROPOSALS) break;
    if (!isRecord(entry)) continue;
    const toolName = typeof entry.tool === "string" ? entry.tool : "";
    const tool = tools.get(toolName);
    if (!tool || !isRecord(entry.arguments)) continue;
    const input = entry.arguments;
    const action = chosenAction(input);
    if (tool.meta.actions && (!action || !tool.meta.actions[action])) continue;
    if (isReadOnlyTriageCall(tool, input)) continue;
    const summary =
      typeof entry.summary === "string" ? entry.summary.trim() : "";
    if (!summary) continue;
    proposals.push({
      tool: toolName,
      ...(action ? { action } : {}),
      arguments: input,
      summary: summary.slice(0, 300),
      effect: inferEffect(tool, input, entry.effect),
    });
  }
  return proposals;
}

type CallToolResult = Awaited<ReturnType<MCPClient["callTool"]>>;

/**
 * The text a call answered. Our server sends `structuredContent` beside an
 * identical text copy, so the copy is read and the structure only used when
 * there is no text at all.
 */
function resultText(result: CallToolResult): string {
  const parts =
    "content" in result && Array.isArray(result.content) ? result.content : [];
  const text = parts
    .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n");
  if (text) return text;
  return "structuredContent" in result && result.structuredContent
    ? JSON.stringify(result.structuredContent)
    : "";
}

async function openPrimary() {
  const connector = await ensurePrimaryConnector();
  if (!connector.enabled || connector.status !== "ready") return null;
  const tools = selectTriageActionTools(
    cachedToolDefinitions(connector),
    new Set(connector.disabledTools),
  );
  if (tools.size === 0) return null;
  return { connector, tools };
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_actions",
  description:
    "Finish by returning the changes this email calls for. An empty list is the usual answer.",
  input_schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        maxItems: MAX_PROPOSALS,
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "Tool name from the catalogue.",
            },
            arguments: {
              type: "object",
              description:
                "Complete arguments for one write call, including `action` for tools that have actions.",
            },
            effect: { type: "string", enum: ["create", "update", "delete"] },
            summary: {
              type: "string",
              description:
                "One plain line saying what accepting does, e.g. 'Add Ana Silva (ana@acme.com) to people'.",
            },
          },
          required: ["tool", "arguments", "effect", "summary"],
          additionalProperties: false,
        },
      },
    },
    required: ["actions"],
    additionalProperties: false,
  },
};

const SYSTEM = `You keep Deniz's personal app in step with his email. The app's records are reachable through the tools in the catalogue below. For the one email you are given, propose the writes it clearly calls for: someone new to add to people, a person's changed details or someone to remove, a new subscription or a price change or a cancellation for the finance rules, and the same kind of change to anything else in the catalogue.

Rules:
- Propose nothing unless the email itself states the change. Most emails need no change at all; then return an empty list.
- Tasks and calendar events are handled elsewhere. Never propose those.
- Before an update or a delete, look the record up with a read action so the arguments carry its real id. Never invent ids. If you cannot find the record, propose nothing for it.
- Before proposing a call to a tool, call describe_tool for it and follow its argument schema exactly.
- Check that the change is not already there: do not add a person who exists or a rule that is already recorded.
- Each proposal is one write call with complete arguments and a one-line summary in plain words.
- Finish with propose_actions.`;

/**
 * Proposes writes to the rest of the app for one email. Fails open: any
 * failure — the connector unconfigured, the model erroring — returns an empty
 * list and triage carries on with its tasks and events.
 */
export async function proposeTriageActions({
  model,
  emailPrompt,
  untrustedNotice,
}: {
  model: string;
  /** The sanitized email block, its untrusted parts already tagged. */
  emailPrompt: string;
  untrustedNotice: string;
}): Promise<ProposedTriageAction[]> {
  let opened: Awaited<ReturnType<typeof openPrimary>>;
  try {
    opened = await openPrimary();
  } catch (error) {
    console.error("triage actions: primary connector unavailable:", error);
    return [];
  }
  if (!opened) return [];
  const { connector, tools } = opened;

  let client: MCPClient | undefined;
  const clientFor = async () => {
    client ??= await openConnectorClient(connector);
    return client;
  };

  let lookups = 0;
  let describes = 0;

  const describeTool: Anthropic.Tool = {
    name: "describe_tool",
    description: "Returns one catalogue tool's argument schema.",
    input_schema: {
      type: "object",
      properties: { tool: { type: "string" } },
      required: ["tool"],
      additionalProperties: false,
    },
  };
  const lookupTool: Anthropic.Tool = {
    name: "lookup",
    description:
      "Runs one read-only call (a list, get or search action) to find existing records and their ids.",
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["tool", "arguments"],
      additionalProperties: false,
    },
  };

  try {
    const { input } = await runToolLoop({
      purpose: "triage-actions",
      source: "email-triage-actions",
      model,
      cachedSystem: `${SYSTEM}\n\nCatalogue:\n${formatTriageToolCatalogue(tools)}`,
      system: untrustedNotice,
      prompt: emailPrompt,
      maxTokens: 2_000,
      temperature: 0,
      outputTool: PROPOSE_TOOL,
      serverTools: [
        {
          tool: describeTool,
          handler: (call) => {
            if (describes >= MAX_DESCRIBES) {
              return "No more schema reads. Finish with propose_actions.";
            }
            describes += 1;
            const tool = tools.get(String(call.tool));
            if (!tool) return "Unknown tool. Use a name from the catalogue.";
            return JSON.stringify(tool.definition.inputSchema).slice(
              0,
              SCHEMA_CHARS,
            );
          },
        },
        {
          tool: lookupTool,
          handler: async (call) => {
            if (lookups >= MAX_LOOKUPS) {
              return "No more lookups. Finish with propose_actions.";
            }
            const tool = tools.get(String(call.tool));
            if (!tool) return "Unknown tool. Use a name from the catalogue.";
            const args = isRecord(call.arguments) ? call.arguments : {};
            if (!isReadOnlyTriageCall(tool, args)) {
              return "lookup only runs read-only actions. Propose writes with propose_actions.";
            }
            lookups += 1;
            const result = await (await clientFor()).callTool({
              name: tool.definition.name,
              arguments: args,
            });
            const text = resultText(result).slice(0, LOOKUP_RESULT_CHARS);
            return result.isError ? `Tool error: ${text}` : text;
          },
        },
      ],
    });
    return validateTriageProposals(input?.actions, tools);
  } catch (error) {
    console.error("triage actions: proposal failed:", error);
    return [];
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/**
 * Runs an accepted proposal. The tool is re-checked against the current
 * catalogue: a tool removed, disabled or denied since triage ran is refused.
 */
export async function executeTriageAction(proposal: {
  tool: string;
  arguments: Record<string, unknown>;
}): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const opened = await openPrimary().catch(() => null);
  if (!opened) {
    return { ok: false, error: "The denizlg24 connector is not available" };
  }
  const tool = opened.tools.get(proposal.tool);
  if (!tool) {
    return { ok: false, error: `${proposal.tool} is no longer available` };
  }
  if (isReadOnlyTriageCall(tool, proposal.arguments)) {
    return { ok: false, error: "Not a write call" };
  }
  const client = await openConnectorClient(opened.connector);
  try {
    const result = await client.callTool({
      name: proposal.tool,
      arguments: proposal.arguments,
    });
    const text = resultText(result).slice(0, RESULT_SUMMARY_CHARS);
    return result.isError
      ? { ok: false, error: text || "The tool reported an error" }
      : { ok: true, result: text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
