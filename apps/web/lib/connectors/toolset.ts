import { createHash } from "node:crypto";
import type { ListToolsResult, MCPClient } from "@ai-sdk/mcp";
import type { ConnectorApproval, McpActionsMeta } from "@repo/schemas";
import { dynamicTool, type JSONSchema7, jsonSchema, type ToolSet } from "ai";
import { uploadFileToStorage } from "@/lib/storage-api";
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
/**
 * Images a single tool result may carry, and what they may weigh once
 * decoded. An enabled connector decides its own `content`, and every image
 * kept here is decoded into a Buffer and uploaded — so without a bound a
 * server that answers with a hundred screenshots exhausts the heap, the
 * upload connections or the bucket, none of which the character budget
 * above touches.
 */
const MAX_RESULT_IMAGES = 8;
const MAX_RESULT_IMAGE_BYTES = 24 * 1024 * 1024;
/** Uploads in flight at once; each holds one whole decoded image. */
const IMAGE_UPLOAD_CONCURRENCY = 2;
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

export type ConnectorImagePart =
  | { type: "image"; mimeType: string; data: string }
  | { type: "image"; mimeType: string; url: string };

export type ConnectorContentPart =
  | { type: "text"; text: string }
  | ConnectorImagePart;

export interface ConnectorToolOutput {
  content: ConnectorContentPart[];
  truncated?: boolean;
}

/** Stores one image a tool returned and answers its URL, or null to keep it inline. */
export type ConnectorImageStore = (
  image: { mimeType: string; data: string },
  name: string,
) => Promise<string | null>;

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

/** What a base64 payload decodes to, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
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
  let images = 0;
  let imageBytes = 0;
  let truncated = false;
  const source =
    result.content && result.content.length > 0
      ? result.content
      : result.structuredContent !== undefined
        ? [{ type: "text", text: JSON.stringify(result.structuredContent) }]
        : [];
  for (const part of source) {
    if (isImagePart(part)) {
      const bytes = base64Bytes(part.data);
      if (
        images >= MAX_RESULT_IMAGES ||
        imageBytes + bytes > MAX_RESULT_IMAGE_BYTES
      ) {
        truncated = true;
        continue;
      }
      images += 1;
      imageBytes += bytes;
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
      text: `[Result truncated at ${MAX_RESULT_CHARS} characters and ${MAX_RESULT_IMAGES} images. Narrow the request — filter, paginate, or fetch one record — to see the rest.]`,
    });
  }
  return { content, ...(truncated ? { truncated } : {}) };
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * A screenshot is stored in the conversation and re-sent on every later
 * model call, so its bytes leave the message here: the stored part carries a
 * URL, and the model sees the image by reference. A store that fails keeps
 * the bytes inline — one heavy message beats a lost result.
 */
export async function offloadConnectorImages(
  output: ConnectorToolOutput,
  store: ConnectorImageStore,
  name: string,
): Promise<ConnectorToolOutput> {
  const content: ConnectorContentPart[] = [...output.content];
  const jobs = content.flatMap((part, at) =>
    part.type === "image" && "data" in part ? [{ at, part }] : [],
  );
  let next = 0;
  // Bounded rather than `Promise.all` over every image: each upload decodes
  // its whole payload into a Buffer and holds a connection, so the peak is
  // the concurrency, not however many images the server chose to send.
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      if (!job) return;
      const extension = IMAGE_EXTENSIONS[job.part.mimeType] ?? "bin";
      const url = await store(job.part, `${name}-${index}.${extension}`);
      if (url) {
        content[job.at] = {
          type: "image",
          mimeType: job.part.mimeType,
          url,
        };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_UPLOAD_CONCURRENCY, jobs.length) },
      () => worker(),
    ),
  );
  return { ...output, content };
}

async function storeConnectorImage(
  image: { mimeType: string; data: string },
  name: string,
): Promise<string | null> {
  try {
    const file = new File([Buffer.from(image.data, "base64")], name, {
      type: image.mimeType,
    });
    return (await uploadFileToStorage(file, "image")).publicUrl;
  } catch (error) {
    console.warn("Connector image kept inline; storing it failed:", error);
    return null;
  }
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
 * A tool whose schema marks a property `x-mcp-header` expects that argument
 * mirrored as an `Mcp-Param-<name>` request header (GitHub's servers do this
 * for `owner`, `repo`, …), and the client adds those headers only for
 * definitions it has itself listed. Ours come from the connector's cache, so
 * the freshly opened client is told about them before its first call — the
 * alternative, `tools/list` on every turn, is what the cache exists to avoid.
 */
export function primeToolHeaderBindings(
  client: { toolsFromDefinitions(definitions: ListToolsResult): unknown },
  definitions: readonly McpToolDefinition[],
): void {
  client.toolsFromDefinitions({
    tools: definitions.map((definition) => ({
      name: definition.name,
      inputSchema: { ...definition.inputSchema },
    })),
  });
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
  /** The conversation or run these turns belong to; servers key cross-turn state on it. */
  session?: string;
  /** Test seam; production stores returned images in the image bucket. */
  storeImage?: ConnectorImageStore;
}): Promise<ConnectorToolset> {
  const storeImage = options.storeImage ?? storeConnectorImage;
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

  const clientFor = (
    connector: IConnector,
    definitions: readonly McpToolDefinition[],
  ) => {
    const key = connector._id.toString();
    let client = clients.get(key);
    if (!client) {
      client = openConnectorClient(connector, {
        ...(options.session ? { session: options.session } : {}),
      }).then((opened) => {
        primeToolHeaderBindings(opened, definitions);
        return opened;
      });
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
    const definitions = cachedToolDefinitions(connector);
    for (const definition of definitions) {
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
          const client = await clientFor(connector, definitions);
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
          return offloadConnectorImages(
            bounded,
            storeImage,
            `${connector.slug}-${definition.name}-${Date.now()}`,
          );
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
                    data:
                      "url" in part
                        ? { type: "url" as const, url: new URL(part.url) }
                        : { type: "data" as const, data: part.data },
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
