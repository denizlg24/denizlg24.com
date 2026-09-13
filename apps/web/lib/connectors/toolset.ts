import { createHash } from "node:crypto";
import type { MCPClient } from "@ai-sdk/mcp";
import type { ConnectorApproval, McpActionsMeta } from "@repo/schemas";
import { dynamicTool, type JSONSchema7, jsonSchema, type ToolSet } from "ai";
import type { IConnector } from "@/models/Connector";
import {
  cachedToolDefinitions,
  describeToolDefinition,
  listConnectors,
  type McpToolDefinition,
  openConnectorClient,
  refreshConnectorTools,
} from "./service";

/** A connector's cached `tools/list` is trusted for this long before a turn re-lists it. */
const TOOL_CACHE_TTL_MS = 30 * 60_000;
/** Text a single tool result may hand the model before it is cut. */
const MAX_RESULT_CHARS = 48_000;
const MAX_TOOL_NAME = 64;

export const CONNECTOR_TOOL_SEPARATOR = "__";

export interface ConnectorToolBinding {
  connectorId: string;
  connectorSlug: string;
  connectorName: string;
  approval: ConnectorApproval;
  builtIn: boolean;
  toolName: string;
  title?: string;
  readOnly: boolean;
  destructive: boolean;
  actions?: McpActionsMeta;
}

export interface UnavailableConnector {
  slug: string;
  name: string;
  detail: string;
}

export interface ConnectorToolset {
  tools: ToolSet;
  bindings: Map<string, ConnectorToolBinding>;
  /** Server-provided guidance; only the primary connector's is trusted. */
  instructions: Array<{ name: string; instructions: string; trusted: boolean }>;
  unavailable: UnavailableConnector[];
  close(): Promise<void>;
}

export type ConnectorContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export interface ConnectorToolOutput {
  content: ConnectorContentPart[];
  truncated?: boolean;
}

export class ConnectorToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorToolError";
  }
}

/**
 * `<slug>__<tool>`, reduced to what every provider accepts in a tool name.
 * OpenAI caps names at 64, so a long one keeps a readable prefix and gains a
 * hash of the full name to stay unique.
 */
export function exposedToolName(slug: string, toolName: string): string {
  const full = `${slug}${CONNECTOR_TOOL_SEPARATOR}${toolName}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  if (full.length <= MAX_TOOL_NAME) return full;
  const digest = createHash("sha256").update(full).digest("hex").slice(0, 8);
  return `${full.slice(0, MAX_TOOL_NAME - 9)}_${digest}`;
}

function textOf(part: unknown): string {
  if (typeof part === "object" && part !== null) {
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return record.text;
    }
  }
  return JSON.stringify(part);
}

function isImagePart(
  part: unknown,
): part is { type: "image"; mimeType: string; data: string } {
  if (typeof part !== "object" || part === null) return false;
  const record = part as Record<string, unknown>;
  return (
    record.type === "image" &&
    typeof record.mimeType === "string" &&
    typeof record.data === "string"
  );
}

/**
 * Keeps what the model needs from a `tools/call` result and bounds it. A
 * server that sends `structuredContent` beside an identical text copy (ours
 * does, per the spec's compatibility rule) is not paid for twice.
 */
export function boundConnectorResult(result: {
  content?: readonly unknown[];
  structuredContent?: unknown;
}): ConnectorToolOutput {
  const content: ConnectorContentPart[] = [];
  let budget = MAX_RESULT_CHARS;
  let truncated = false;
  const source =
    result.content && result.content.length > 0
      ? result.content
      : result.structuredContent !== undefined
        ? [{ type: "text", text: JSON.stringify(result.structuredContent) }]
        : [];
  for (const part of source) {
    if (isImagePart(part)) {
      content.push({ type: "image", mimeType: part.mimeType, data: part.data });
      continue;
    }
    const text = textOf(part);
    if (budget <= 0) {
      truncated = true;
      continue;
    }
    if (text.length > budget) {
      content.push({ type: "text", text: text.slice(0, budget) });
      truncated = true;
      budget = 0;
    } else {
      content.push({ type: "text", text });
      budget -= text.length;
    }
  }
  if (truncated) {
    content.push({
      type: "text",
      text: `[Result truncated at ${MAX_RESULT_CHARS} characters. Narrow the request — filter, paginate, or fetch one record — to see the rest.]`,
    });
  }
  return { content, ...(truncated ? { truncated } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitPropertyNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitPropertyNames);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      key === "propertyNames" ? [] : [[key, omitPropertyNames(child)]],
    ),
  );
}

/**
 * OpenAI drops JSON Schema `propertyNames` before a request and emits a
 * compatibility warning. MCP still validates the original schema when the
 * tool is called, so removing only that unsupported keyword here keeps the
 * same execution-time guarantees without sending a schema the model cannot
 * enforce.
 */
export function connectorInputSchemaForModel(
  schema: JSONSchema7,
  model: string,
): JSONSchema7 {
  return model.startsWith("openai/")
    ? (omitPropertyNames(schema) as JSONSchema7)
    : schema;
}

function isConnectorToolOutput(value: unknown): value is ConnectorToolOutput {
  return isRecord(value) && Array.isArray(value.content);
}

function isStale(connector: IConnector): boolean {
  const fetchedAt = connector.toolCache?.fetchedAt?.getTime();
  return !fetchedAt || Date.now() - fetchedAt > TOOL_CACHE_TTL_MS;
}

function bindingFor(
  connector: IConnector,
  definition: McpToolDefinition,
): ConnectorToolBinding {
  const described = describeToolDefinition(definition);
  return {
    connectorId: connector._id.toString(),
    connectorSlug: connector.slug,
    connectorName: connector.name,
    approval: connector.approval,
    builtIn: connector.builtIn,
    toolName: definition.name,
    ...(described.title ? { title: described.title } : {}),
    readOnly: described.readOnly,
    destructive: described.destructive,
    ...(described.actions ? { actions: described.actions } : {}),
  };
}

/**
 * The connector tools for one turn. Definitions come from each connector's
 * cache; a client is opened only when the model first calls one of its tools,
 * so a turn that never touches a connector never connects to it.
 */
export async function openConnectorToolset(options: {
  /** Slugs the turn may use; absent means every enabled connector. */
  only?: readonly string[];
  /** Fully qualified Gateway id, used for provider schema compatibility. */
  model: string;
}): Promise<ConnectorToolset> {
  const connectors = (await listConnectors()).filter(
    (connector) =>
      connector.enabled &&
      (!options.only || options.only.includes(connector.slug)),
  );

  const ready = await Promise.all(
    connectors.map(async (connector) =>
      connector.status === "needs-auth" || !isStale(connector)
        ? connector
        : refreshConnectorTools(connector),
    ),
  );

  const tools: ToolSet = {};
  const bindings = new Map<string, ConnectorToolBinding>();
  const instructions: ConnectorToolset["instructions"] = [];
  const unavailable: UnavailableConnector[] = [];
  const clients = new Map<string, Promise<MCPClient>>();

  const clientFor = (connector: IConnector) => {
    const key = connector._id.toString();
    let client = clients.get(key);
    if (!client) {
      client = openConnectorClient(connector);
      clients.set(key, client);
    }
    return client;
  };

  for (const connector of ready) {
    if (connector.status !== "ready") {
      unavailable.push({
        slug: connector.slug,
        name: connector.name,
        detail: connector.statusDetail ?? connector.status,
      });
      continue;
    }
    if (connector.toolCache?.instructions) {
      instructions.push({
        name: connector.name,
        instructions: connector.toolCache.instructions,
        trusted: connector.builtIn,
      });
    }
    const disabled = new Set(connector.disabledTools);
    for (const definition of cachedToolDefinitions(connector)) {
      if (disabled.has(definition.name)) continue;
      const name = exposedToolName(connector.slug, definition.name);
      const binding = bindingFor(connector, definition);
      bindings.set(name, binding);
      tools[name] = dynamicTool({
        description: definition.description ?? definition.title ?? "",
        ...(binding.title ? { title: binding.title } : {}),
        metadata: {
          connector: connector.slug,
          connectorName: connector.name,
          toolName: definition.name,
          ...(binding.title ? { title: binding.title } : {}),
        },
        inputSchema: jsonSchema(
          connectorInputSchemaForModel(
            {
              ...definition.inputSchema,
              properties: definition.inputSchema.properties ?? {},
            },
            options.model,
          ),
        ),
        execute: async (input, { abortSignal }) => {
          const client = await clientFor(connector);
          const result = await client.callTool({
            name: definition.name,
            arguments: isRecord(input) ? input : {},
            options: { signal: abortSignal },
          });
          const bounded = boundConnectorResult({
            content: Array.isArray(result.content) ? result.content : [],
            structuredContent: result.structuredContent,
          });
          if (result.isError) {
            throw new ConnectorToolError(
              bounded.content
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("\n")
                .slice(0, 4_000) || "The tool reported an error",
            );
          }
          return bounded;
        },
        toModelOutput: ({ output }) => {
          const content = isConnectorToolOutput(output) ? output.content : [];
          return {
            type: "content",
            value: content.map((part) =>
              part.type === "text"
                ? { type: "text" as const, text: part.text }
                : {
                    type: "file" as const,
                    mediaType: part.mimeType,
                    data: { type: "data" as const, data: part.data },
                  },
            ),
          };
        },
      });
    }
  }

  return {
    tools,
    bindings,
    instructions,
    unavailable,
    async close() {
      const opened = await Promise.allSettled(clients.values());
      await Promise.allSettled(
        opened.map((entry) =>
          entry.status === "fulfilled" ? entry.value.close() : undefined,
        ),
      );
    },
  };
}
