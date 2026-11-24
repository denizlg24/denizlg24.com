import type { McpServer } from "@modelcontextprotocol/server";
import {
  MCP_CATALOG_CALL_TOOLS,
  MCP_CATALOG_TOOLS,
  type McpOperationKind,
  type McpToolProfile,
  mcpCatalogCallSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  advertisedOnly,
  type CatalogEntry,
  type CatalogOperation,
  catalogEntries,
  fail,
  isRecord,
  ok,
  SINGLE_OPERATION,
  surfaceMeta,
  type ToolResult,
} from "./define";

const APPS = ["web", "cloud", "forge", "storage", "status"] as const;
const KINDS = ["read", "write", "destructive"] as const;
const SEARCH_LIMIT = 25;
/** Leaves room under a client's own result cap (web cuts at 48 000). */
const DESCRIBE_MAX_CHARS = 40_000;
const SUMMARY_CHARS = 120;

function firstSentence(text: string, limit: number): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  const sentence = line.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? line;
  return sentence.length > limit
    ? `${sentence.slice(0, limit - 1)}…`
    : sentence;
}

/** `id, title?, tags?` — enough to call without describing first, often. */
function argumentHint(operation: CatalogOperation): string {
  return Object.entries(operation.schema.shape)
    .map(([key, field]) =>
      field.safeParse(undefined).success ? `${key}?` : key,
    )
    .join(", ");
}

function inputSchemaOf(operation: CatalogOperation): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(operation.schema, {
    io: "input",
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  return schema;
}

function appOf(name: string): string {
  return name.slice(0, name.indexOf("_"));
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function score(entry: CatalogEntry, query: string[]): number {
  let total = 0;
  const name = entry.name.toLowerCase();
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const operations = Object.entries(entry.operations);
  for (const token of query) {
    let best = 0;
    if (name.includes(token)) best = 4;
    else if (title.includes(token)) best = 3;
    else if (operations.some(([op]) => op.includes(token))) best = 2;
    else if (
      description.includes(token) ||
      operations.some(([, op]) => op.description.toLowerCase().includes(token))
    )
      best = 1;
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

function summarize(entry: CatalogEntry) {
  return {
    resource: entry.name,
    title: entry.title,
    summary: firstSentence(entry.description, SUMMARY_CHARS),
    operations: Object.fromEntries(
      Object.entries(entry.operations).map(([name, operation]) => [
        name,
        `${operation.kind}(${argumentHint(operation)})${
          entry.single
            ? ""
            : ` ${firstSentence(operation.description, SUMMARY_CHARS)}`
        }`,
      ]),
    ),
  };
}

/** Words of a tool name past its app prefix, which every sibling shares. */
function nameWords(name: string): string[] {
  return tokens(name.slice(name.indexOf("_") + 1));
}

function suggestions(
  entries: ReadonlyMap<string, CatalogEntry>,
  requested: string,
): string[] {
  const wanted = nameWords(requested);
  // Prefix either way, so a singular finds its plural and back.
  const alike = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
  return [...entries.values()]
    .map((entry) => {
      const words = nameWords(entry.name);
      return {
        name: entry.name,
        shared: wanted.filter((word) => words.some((w) => alike(w, word)))
          .length,
        distance: Math.abs(entry.name.length - requested.length),
      };
    })
    .filter((candidate) => candidate.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        a.distance - b.distance ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 5)
    .map((candidate) => candidate.name);
}

type Resolved =
  | { entry: CatalogEntry; error?: never }
  | { entry?: never; error: ToolResult };

function resolveResource(
  entries: ReadonlyMap<string, CatalogEntry>,
  direct: ReadonlySet<string>,
  resource: string,
): Resolved {
  const entry = entries.get(resource);
  if (entry) return { entry };
  if (direct.has(resource)) {
    return {
      error: fail(400, {
        code: "DIRECT_TOOL",
        resource,
        message: `${resource} is not reachable through the catalog; call the ${resource} tool directly.`,
      }),
    };
  }
  return {
    error: fail(404, {
      code: "UNKNOWN_RESOURCE",
      resource,
      suggestions: suggestions(entries, resource),
      message: `No resource ${resource}. Find one with ${MCP_CATALOG_TOOLS.search}.`,
    }),
  };
}

function operationNames(entry: CatalogEntry): string[] {
  return Object.keys(entry.operations);
}

function resolveOperation(
  entry: CatalogEntry,
  requested: string | undefined,
):
  | { name: string; operation: CatalogOperation; error?: never }
  | { name?: never; operation?: never; error: ToolResult } {
  const names = operationNames(entry);
  const name = requested ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined) {
    return {
      error: fail(400, {
        code: "OPERATION_REQUIRED",
        resource: entry.name,
        operations: names,
      }),
    };
  }
  const operation = Object.hasOwn(entry.operations, name)
    ? entry.operations[name]
    : undefined;
  if (!operation) {
    return {
      error: fail(400, {
        code: "UNKNOWN_OPERATION",
        resource: entry.name,
        operation: name,
        operations: names,
      }),
    };
  }
  return { name, operation };
}

/** The operation's own parse refusal, which the caller can fix with the schema. */
function invalidInput(result: ToolResult): Record<string, unknown> | null {
  const error = result.structuredContent?.error;
  return result.isError === true &&
    isRecord(error) &&
    error.code === "INVALID_INPUT"
    ? error
    : null;
}

const searchInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Words matched against resource names, titles, operations and descriptions; every word must match",
    ),
  app: z.enum(APPS).optional(),
  kind: z
    .enum(KINDS)
    .optional()
    .describe("Only resources with at least one operation of this kind"),
  cursor: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("nextCursor from the previous page"),
  limit: z.number().int().min(1).max(100).optional(),
});

const describeInput = z.object({
  resource: z.string().min(1).describe("A resource name, e.g. web_notes"),
  operation: z
    .string()
    .min(1)
    .optional()
    .describe("One operation; omit for all of them"),
});

const callInput = z.object({
  resource: mcpCatalogCallSchema.shape.resource.describe(
    "A resource name from the catalog, e.g. web_notes",
  ),
  operation: mcpCatalogCallSchema.shape.operation.describe(
    `The operation, e.g. list or create. Omit for a resource with a single operation (${SINGLE_OPERATION}).`,
  ),
  args: mcpCatalogCallSchema.shape.args.describe(
    "The operation's own arguments, exactly as catalog_describe lists them",
  ),
});

const CALL_DESCRIPTIONS: Record<McpOperationKind, string> = {
  read: `Runs a read-only operation of a catalog resource, e.g. {"resource":"web_notes","operation":"get","args":{"noteId":"…"}}. Writes are refused here: use ${MCP_CATALOG_TOOLS.write} or ${MCP_CATALOG_TOOLS.destructive}.`,
  write: `Runs an operation that changes data but deletes nothing, e.g. {"resource":"web_notes","operation":"rename","args":{"noteId":"…","name":"…"}}. Read-only and destructive operations are refused here.`,
  destructive: `Runs an operation that deletes, overwrites or otherwise cannot be undone, e.g. {"resource":"web_notes","operation":"delete","args":{"noteId":"…"}}. Only destructive operations are accepted here.`,
};

/**
 * Registers the catalog over every tool already defined on `server`: one
 * search, one describe, and one call tool per operation kind. The call tools
 * carry honest annotations because each refuses operations of the other
 * kinds, so a client that only understands tool-level hints still prompts for
 * exactly the operations it would prompt for by name.
 */
export function registerCatalog(server: McpServer): void {
  const all = catalogEntries(server);
  const entries = new Map(
    all.filter((entry) => !entry.direct).map((entry) => [entry.name, entry]),
  );
  const direct = new Set(
    all.filter((entry) => entry.direct).map((entry) => entry.name),
  );

  const index = APPS.map((app) => {
    const names = [...entries.keys()]
      .filter((name) => appOf(name) === app)
      .map((name) => name.slice(app.length + 1));
    return names.length > 0 ? `${app}_: ${names.join(" ")}` : "";
  })
    .filter(Boolean)
    .join("\n");

  server.registerTool(
    MCP_CATALOG_TOOLS.search,
    {
      title: "Search the tool catalog",
      description: `Finds resources (every tool named in the server instructions) and their operations, with each operation's kind and arguments (\`?\` = optional). Call a resource through ${MCP_CATALOG_TOOLS.read} / ${MCP_CATALOG_TOOLS.write} / ${MCP_CATALOG_TOOLS.destructive}; ${MCP_CATALOG_TOOLS.describe} gives the full argument schema. Resources:\n${index}`,
      inputSchema: advertisedOnly(searchInput),
      _meta: surfaceMeta("compact"),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = searchInput.safeParse(args);
      if (!parsed.success) {
        return fail(400, {
          code: "INVALID_INPUT",
          issues: parsed.error.issues,
        });
      }
      const { query, app, kind } = parsed.data;
      const cursor = parsed.data.cursor ?? 0;
      const limit = parsed.data.limit ?? SEARCH_LIMIT;
      const words = tokens(query ?? "");
      const matched = [...entries.values()]
        .filter((entry) => !app || appOf(entry.name) === app)
        .filter(
          (entry) =>
            !kind ||
            Object.values(entry.operations).some(
              (operation) => operation.kind === kind,
            ),
        )
        .map((entry, order) => ({
          entry,
          order,
          score: words.length > 0 ? score(entry, words) : 1,
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order);
      const pageOf = matched.slice(cursor, cursor + limit);
      return ok({
        total: matched.length,
        resources: pageOf.map(({ entry }) => summarize(entry)),
        ...(cursor + limit < matched.length
          ? { nextCursor: cursor + limit }
          : {}),
      });
    },
  );

  server.registerTool(
    MCP_CATALOG_TOOLS.describe,
    {
      title: "Describe a catalog resource",
      description: `Returns a resource's operations with their full JSON Schema, kind and the call tool that runs each. Describe one operation when a resource's schemas are large (workspace blocks, pages, themes).`,
      inputSchema: advertisedOnly(describeInput),
      _meta: surfaceMeta("compact"),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = describeInput.safeParse(args);
      if (!parsed.success) {
        return fail(400, {
          code: "INVALID_INPUT",
          issues: parsed.error.issues,
        });
      }
      const resolved = resolveResource(entries, direct, parsed.data.resource);
      if (resolved.error) return resolved.error;
      const { entry } = resolved;
      const chosen =
        parsed.data.operation === undefined
          ? operationNames(entry)
          : [parsed.data.operation];
      const operations = [];
      for (const name of chosen) {
        const found = resolveOperation(entry, name);
        if (found.error) return found.error;
        operations.push({
          operation: found.name,
          kind: found.operation.kind,
          callWith: MCP_CATALOG_CALL_TOOLS[found.operation.kind],
          description: found.operation.description,
          arguments: argumentHint(found.operation),
          inputSchema: inputSchemaOf(found.operation),
        });
      }
      const described = {
        resource: entry.name,
        title: entry.title,
        description: entry.description,
        operations,
      };
      if (
        operations.length === 1 ||
        JSON.stringify(described).length <= DESCRIBE_MAX_CHARS
      ) {
        return ok(described);
      }
      return ok({
        ...described,
        operations: operations.map(({ inputSchema: _schema, ...rest }) => rest),
        schemasOmitted: `Too large to list together; describe one operation for its schema.`,
      });
    },
  );

  for (const kind of KINDS) {
    const name = MCP_CATALOG_CALL_TOOLS[kind];
    server.registerTool(
      name,
      {
        title: `Run a ${kind} operation`,
        description: CALL_DESCRIPTIONS[kind],
        inputSchema: advertisedOnly(callInput),
        _meta: surfaceMeta("compact"),
        annotations: {
          readOnlyHint: kind === "read",
          destructiveHint: kind === "destructive",
          idempotentHint: kind === "read",
          openWorldHint: false,
        },
      },
      async (args) => {
        const parsed = callInput.safeParse(args);
        if (!parsed.success) {
          return fail(400, {
            code: "INVALID_INPUT",
            issues: parsed.error.issues,
          });
        }
        const resolved = resolveResource(entries, direct, parsed.data.resource);
        if (resolved.error) return resolved.error;
        const found = resolveOperation(resolved.entry, parsed.data.operation);
        if (found.error) return found.error;
        if (found.operation.kind !== kind) {
          return fail(400, {
            code: "WRONG_TOOL",
            resource: resolved.entry.name,
            operation: found.name,
            kind: found.operation.kind,
            message: `${resolved.entry.name} ${found.name} is a ${found.operation.kind} operation; call it with ${MCP_CATALOG_CALL_TOOLS[found.operation.kind]}.`,
          });
        }
        try {
          const result = await found.operation.invoke(parsed.data.args ?? {});
          const invalid = invalidInput(result);
          if (!invalid) return result;
          return fail(400, {
            ...invalid,
            resource: resolved.entry.name,
            operation: found.name,
            inputSchema: inputSchemaOf(found.operation),
          });
        } catch (error) {
          return fail(
            null,
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );
  }
}

/**
 * The compact profile lists only the compact surface. Removed tools stay in
 * the catalog — their handlers are bound there — so nothing becomes
 * unreachable, only unlisted.
 */
export function applyToolProfile(
  server: McpServer,
  profile: McpToolProfile,
): void {
  if (profile !== "compact") return;
  for (const entry of catalogEntries(server)) {
    if (!entry.direct) entry.registered.remove();
  }
}
