import type {
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Upstream } from "../upstream";

export type Side = "cloud" | "web";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface CallInit {
  query?: Query;
  /** JSON-encoded. Mutually exclusive with `raw`. */
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Assignable to the SDK's CallToolResult; kept narrow so results are inspectable. */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Path segments are encoded so an id can never rewrite the route. */
export function p(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  return strings.reduce(
    (path, chunk, index) =>
      path +
      chunk +
      (index < values.length ? encodeURIComponent(String(values[index])) : ""),
    "",
  );
}

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

const TEXT_TYPES =
  /^(text\/|application\/(json|x-ndjson|xml|javascript|yaml|x-yaml|toml))/;

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204 || response.status === 205) return null;
  if (/json/.test(contentType)) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (TEXT_TYPES.test(contentType) || contentType === "") {
    return await response.text();
  }
  const bytes = await response.arrayBuffer();
  return { contentType, bytes: bytes.byteLength };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ok(
  value: unknown,
  extra: Record<string, unknown> = {},
): ToolResult {
  const structured = isRecord(value) ? value : { data: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: { ...structured, ...extra },
  };
}

export function fail(status: number | null, error: unknown): ToolResult {
  const payload = { status, error };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

/** Turns an upstream response into a tool result: non-2xx is `isError`. */
export async function fromResponse(response: Response): Promise<ToolResult> {
  const body = await readBody(response);
  if (!response.ok) return fail(response.status, body);
  // Keyed so an upstream body's own `status` field survives.
  return ok(body, { httpStatus: response.status });
}

export interface SideApi {
  raw: (method: Method, path: string, init?: CallInit) => Promise<Response>;
  get: (path: string, query?: Query) => Promise<ToolResult>;
  post: (path: string, body?: unknown, query?: Query) => Promise<ToolResult>;
  put: (path: string, body?: unknown, query?: Query) => Promise<ToolResult>;
  patch: (path: string, body?: unknown, query?: Query) => Promise<ToolResult>;
  delete: (path: string, query?: Query, body?: unknown) => Promise<ToolResult>;
}

export interface Api {
  cloud: SideApi;
  web: SideApi;
}

function sideApi(call: Upstream["cloud"]): SideApi {
  const raw: SideApi["raw"] = (method, path, init = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    let body: BodyInit | undefined = init.raw;
    if (init.body !== undefined) {
      headers["content-type"] ??= "application/json";
      body = JSON.stringify(init.body);
    }
    return call(withQuery(path, init.query), {
      method,
      headers,
      body,
      signal: init.signal,
    });
  };
  const json =
    (method: Method) =>
    async (path: string, init: CallInit = {}) => {
      try {
        return await fromResponse(await raw(method, path, init));
      } catch (error) {
        return fail(
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
    };
  return {
    raw,
    get: (path, query) => json("GET")(path, { query }),
    post: (path, body, query) => json("POST")(path, { body, query }),
    put: (path, body, query) => json("PUT")(path, { body, query }),
    patch: (path, body, query) => json("PATCH")(path, { body, query }),
    delete: (path, query, body) => json("DELETE")(path, { query, body }),
  };
}

export function createApi(upstream: Upstream): Api {
  return { cloud: sideApi(upstream.cloud), web: sideApi(upstream.web) };
}

type Shape = Record<string, z.ZodType>;
type ObjectSchema = z.ZodObject<Shape>;
type Arguments = Record<string, unknown>;

export const TOOL_NAME = /^(forge|cloud|storage|web)_[a-z0-9]+(_[a-z0-9]+)*$/;

function assertToolName(name: string) {
  if (!TOOL_NAME.test(name)) {
    throw new Error(
      `Tool name ${name} does not follow <app>_<resource>_<verb>`,
    );
  }
}

/**
 * The SDK is handed a JSON Schema to advertise and a validate that only checks
 * for an object; the tool's own zod schema is the one that parses. For an
 * action tool this is load-bearing: the advertised schema merges every
 * action's fields, and validating against it would apply one action's
 * `.default()` or transform to every other action sharing the field name — an
 * update would arrive carrying create's defaults. `defineTool` goes the same
 * way so both kinds report bad input identically and neither needs a cast.
 */
function advertisedOnly(
  schema: ObjectSchema,
): StandardSchemaWithJSON<unknown, Arguments> {
  return {
    "~standard": {
      version: 1,
      vendor: "denizlg24-mcp",
      validate: (value) => {
        if (value === undefined) return { value: {} };
        if (isRecord(value)) return { value };
        return { issues: [{ message: "Expected an object of arguments" }] };
      },
      jsonSchema: schema["~standard"].jsonSchema,
    },
  };
}

interface ActionFlags {
  description: string;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
}

export interface ActionSpec<S extends ObjectSchema> extends ActionFlags {
  input: S;
  run: (args: z.output<S>) => Promise<ToolResult>;
}

export interface BareActionSpec extends ActionFlags {
  run: () => Promise<ToolResult>;
}

/**
 * An action with its schema bound in: parsing happens inside, typed against
 * the action's own schema, so actions of different shapes can share one map.
 */
export interface BoundAction extends ActionFlags {
  shape: Shape;
  invoke: (args: Arguments, label: string) => Promise<ToolResult>;
}

export function action<S extends ObjectSchema>(
  spec: ActionSpec<S>,
): BoundAction;
export function action(spec: BareActionSpec): BoundAction;
export function action<S extends ObjectSchema>(
  spec: ActionSpec<S> | BareActionSpec,
): BoundAction {
  const { description, readOnly, destructive, idempotent } = spec;
  const flags = { description, readOnly, destructive, idempotent };
  if (!("input" in spec)) {
    return { ...flags, shape: {}, invoke: () => spec.run() };
  }
  return {
    ...flags,
    shape: spec.input.shape,
    invoke: async (args, label) => {
      const parsed = spec.input.safeParse(args);
      if (!parsed.success) {
        return fail(400, {
          code: "INVALID_INPUT",
          action: label,
          issues: parsed.error.issues,
        });
      }
      return spec.run(parsed.data);
    },
  };
}

export interface ToolSpec<S extends ObjectSchema> {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  run: (args: z.output<S>) => Promise<ToolResult>;
}

/** One operation, one precise schema. */
export function defineTool<S extends ObjectSchema>(
  server: McpServer,
  spec: ToolSpec<S>,
): void {
  assertToolName(spec.name);
  const bound = action({
    description: spec.description,
    input: spec.input,
    run: spec.run,
  });
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: advertisedOnly(spec.input),
      annotations: { openWorldHint: false, ...spec.annotations },
    },
    (args) => bound.invoke(args, spec.name),
  );
}

export interface ActionsSpec {
  name: string;
  title: string;
  description: string;
  actions: Record<string, BoundAction>;
}

/**
 * One tool per resource, `action` selecting the operation. The advertised
 * schema is the union of every action's fields, each marked with the actions
 * that use it; the call is parsed by the chosen action's own schema, so a
 * missing field is refused before anything reaches upstream.
 */
export function defineActions(server: McpServer, spec: ActionsSpec): void {
  assertToolName(spec.name);
  const [firstName, ...otherNames] = Object.keys(spec.actions);
  if (firstName === undefined) {
    throw new Error(`${spec.name} declares no actions`);
  }

  const fields = new Map<string, { schemas: z.ZodType[]; actions: string[] }>();
  for (const [name, entry] of Object.entries(spec.actions)) {
    for (const [key, schema] of Object.entries(entry.shape)) {
      if (key === "action") {
        throw new Error(
          `${spec.name}.${name} reuses the reserved field "action"`,
        );
      }
      const field = fields.get(key) ?? { schemas: [], actions: [] };
      if (!field.schemas.includes(schema)) field.schemas.push(schema);
      field.actions.push(name);
      fields.set(key, field);
    }
  }
  const shape: Shape = {
    action: z.enum([firstName, ...otherNames]).describe(
      Object.entries(spec.actions)
        .map(([name, entry]) => `${name}: ${entry.description}`)
        .join("\n"),
    ),
  };
  for (const [key, field] of fields) {
    const [first, ...rest] = field.schemas;
    if (!first) continue;
    const base = rest.length === 0 ? first : z.union([first, ...rest]);
    const description = field.schemas
      .map((schema) => schema.description)
      .find((text) => text);
    shape[key] = base
      .optional()
      .describe(
        `${description ? `${description} ` : ""}[${field.actions.join(", ")}]`,
      );
  }
  const all = Object.values(spec.actions);
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: advertisedOnly(z.object(shape)),
      annotations: {
        openWorldHint: false,
        readOnlyHint: all.every((entry) => entry.readOnly === true),
        destructiveHint: all.some((entry) => entry.destructive === true),
        idempotentHint: all.every(
          (entry) => entry.readOnly === true || entry.idempotent === true,
        ),
      },
    },
    (args) => {
      const { action: chosen, ...rest } = args;
      const entry =
        typeof chosen === "string" && Object.hasOwn(spec.actions, chosen)
          ? spec.actions[chosen]
          : undefined;
      if (!entry)
        return Promise.resolve(fail(400, `Unknown action ${String(chosen)}`));
      return entry.invoke(rest, String(chosen));
    },
  );
}

/**
 * Reads an SSE or line stream for a bounded time and size. Build and runtime
 * logs are served as live streams that never end on their own; a tool result
 * has to.
 */
export async function collectStream(
  response: Response,
  options: { maxMs: number; maxBytes: number; controller: AbortController },
): Promise<{ lines: string[]; complete: boolean; truncated: boolean }> {
  const lines: string[] = [];
  let complete = false;
  let truncated = false;
  let bytes = 0;
  if (!response.body) return { lines, complete: true, truncated };
  const timer = setTimeout(() => options.controller.abort(), options.maxMs);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const sse = /text\/event-stream/.test(
    response.headers.get("content-type") ?? "",
  );
  let event = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
        if (!sse) {
          if (line) lines.push(line);
          continue;
        }
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          if (event === "end") {
            complete = true;
          } else {
            lines.push(line.slice(5).replace(/^ /, ""));
          }
        } else if (line === "") {
          event = "";
        }
      }
      if (complete) break;
      if (bytes >= options.maxBytes) {
        truncated = true;
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  if (!sse && pending) lines.push(pending);
  return { lines, complete, truncated };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/** Inline file content for upload tools: exactly one of text or base64. */
export const uploadFields = {
  filename: z.string().min(1),
  text: z.string().optional().describe("UTF-8 content"),
  base64: z.string().optional().describe("Binary content"),
  contentType: z.string().optional(),
};

export function decodeUpload(input: {
  text?: string;
  base64?: string;
}): { bytes: Buffer } | { error: ToolResult } {
  if ((input.text === undefined) === (input.base64 === undefined)) {
    return { error: fail(400, "Exactly one of text or base64 is required") };
  }
  const bytes =
    input.text !== undefined
      ? Buffer.from(input.text, "utf8")
      : Buffer.from(input.base64 ?? "", "base64");
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    return { error: fail(413, `Upload exceeds ${UPLOAD_MAX_BYTES} bytes`) };
  }
  return { bytes };
}

export function blobOf(bytes: Buffer, contentType?: string): Blob {
  return new Blob([new Uint8Array(bytes)], {
    type: contentType ?? "application/octet-stream",
  });
}

/** POSTs one file as multipart/form-data under `field` (default "file"). */
export async function multipart(
  side: SideApi,
  path: string,
  file: {
    bytes: Buffer;
    filename: string;
    contentType?: string;
    field?: string;
  },
): Promise<ToolResult> {
  const form = new FormData();
  form.set(
    file.field ?? "file",
    blobOf(file.bytes, file.contentType),
    file.filename,
  );
  try {
    return await fromResponse(await side.raw("POST", path, { raw: form }));
  } catch (error) {
    return fail(null, error instanceof Error ? error.message : String(error));
  }
}

/** The same fields, every one optional — the update half of a create/update pair. */
export function partial<S extends Shape>(shape: S) {
  return z.object(shape).partial().shape;
}

export const uuid = z.uuid();
export const page = z.number().int().min(1).optional().describe("1-based page");
export const limit = z.number().int().min(1).optional();
