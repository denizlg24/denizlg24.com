import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  MCP_ACTIONS_META_KEY,
  MCP_CATALOG_CALL_TOOLS,
  MCP_SURFACE_META_KEY,
  MCP_TOOL_PROFILE_HEADER,
  type McpOperationKind,
  mcpActionsMetaSchema,
} from "@repo/schemas";
import { z } from "zod";
import { currentToolProfile, withRequestContext } from "../request-context";
import { createClient, recordingUpstream } from "./harness.test-util";
import { DIRECT_TOOLS } from "./surface";
import {
  compactOf,
  type ListedTool,
  listProfile,
  sizeOf,
} from "./surface-measure.test-util";

const full = await listProfile("full");
const compact = await listProfile("compact");

interface Operation {
  resource: string;
  operation: string;
  kind: McpOperationKind;
  /** The arguments a by-name call takes for the same operation. */
  direct: (args: Record<string, unknown>) => Record<string, unknown>;
}

function operationsOf(tool: ListedTool): Operation[] {
  const actions = mcpActionsMetaSchema.safeParse(
    tool._meta?.[MCP_ACTIONS_META_KEY],
  );
  if (actions.success) {
    return Object.entries(actions.data).map(([operation, flags]) => ({
      resource: tool.name,
      operation,
      kind: flags.readOnly
        ? "read"
        : flags.destructive
          ? "destructive"
          : "write",
      direct: (args) => ({ action: operation, ...args }),
    }));
  }
  return [
    {
      resource: tool.name,
      operation: "run",
      kind:
        tool.annotations?.readOnlyHint === true
          ? "read"
          : tool.annotations?.destructiveHint === true
            ? "destructive"
            : "write",
      direct: (args) => args,
    },
  ];
}

const catalogTools = full.filter(
  (tool) => tool._meta?.[MCP_SURFACE_META_KEY] === "catalog",
);
const operations = catalogTools.flatMap(operationsOf);

describe("surfaces", () => {
  test("the full profile keeps every tool and adds only the catalog", () => {
    const names = full.map((tool) => tool.name);
    expect(names.filter((name) => name.startsWith("catalog_")).sort()).toEqual([
      "catalog_describe",
      "catalog_destructive",
      "catalog_read",
      "catalog_search",
      "catalog_write",
    ]);
    expect(full.length).toBeGreaterThanOrEqual(270);
    for (const tool of full) {
      expect(["compact", "catalog"]).toContain(
        String(tool._meta?.[MCP_SURFACE_META_KEY]),
      );
    }
  });

  test("the compact profile lists the compact surface and nothing else", () => {
    expect(compact.map((tool) => tool.name).sort()).toEqual(
      compactOf(full)
        .map((tool) => tool.name)
        .sort(),
    );
    expect(compact.map((tool) => tool.name).sort()).toEqual(
      [
        "whoami",
        ...Object.keys(DIRECT_TOOLS),
        ...Object.values(MCP_CATALOG_CALL_TOOLS),
        "catalog_search",
        "catalog_describe",
      ].sort(),
    );
  });

  test("the compact surface stays a small fraction of the full one", () => {
    const small = sizeOf(compact);
    const large = sizeOf(full);
    expect(small.tools).toBeLessThanOrEqual(25);
    expect(small.modelBytes).toBeLessThan(32 * 1024);
    expect(small.modelBytes / large.modelBytes).toBeLessThan(0.08);
  });

  test("the profile is read from the header or the query, defaulting to full", () => {
    const at = (url: string, headers: Record<string, string> = {}) =>
      withRequestContext(new Request(url, { headers }), currentToolProfile);
    expect(at("https://mcp.test/mcp")).toBe("full");
    expect(at("https://mcp.test/mcp?profile=compact")).toBe("compact");
    expect(at("https://mcp.test/mcp?profile=bogus")).toBe("full");
    expect(
      at("https://mcp.test/mcp?profile=compact", {
        [MCP_TOOL_PROFILE_HEADER]: "full",
      }),
    ).toBe("full");
  });

  test("call tools carry the annotations of the one kind they accept", () => {
    const byName = new Map(full.map((tool) => [tool.name, tool]));
    expect(byName.get("catalog_read")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(byName.get("catalog_write")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.get("catalog_destructive")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
});

describe("routing", () => {
  // Forge list summaries warn when the stub body is not a real listing.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  afterAll(() => warn.mockRestore());

  test("every operation answers through its kind's call tool exactly as by name", async () => {
    expect(operations.length).toBeGreaterThan(500);
    for (const op of operations) {
      const viaName = recordingUpstream();
      const viaCatalog = recordingUpstream();
      const named = await createClient(viaName.upstream).call(
        op.resource,
        op.direct({}),
      );
      const routed = await createClient(viaCatalog.upstream).call(
        MCP_CATALOG_CALL_TOOLS[op.kind],
        {
          resource: op.resource,
          operation: op.operation,
          args: {},
        },
      );
      const label = `${op.resource} ${op.operation}`;
      expect(
        viaCatalog.calls.map((call) => [call.method, call.path, call.body]),
        label,
      ).toEqual(
        viaName.calls.map((call) => [call.method, call.path, call.body]),
      );
      expect(Boolean(routed.isError), label).toBe(Boolean(named.isError));
    }
  }, 120_000);

  test("routes a real call with its arguments", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    await client.call("catalog_write", {
      resource: "web_notes",
      operation: "rename",
      args: { noteId: "n/1", name: "Thesis" },
    });
    await client.call("catalog_destructive", {
      resource: "forge_target_delete",
      args: { targetId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      [
        "PUT",
        "/api/admin/notes/n%2F1/name",
        JSON.stringify({ name: "Thesis" }),
      ],
      [
        "DELETE",
        "/api/deploy/targets/11111111-1111-4111-8111-111111111111",
        null,
      ],
    ]);
  });

  test("the compact profile still routes to tools it does not list", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, undefined, {
      headers: { [MCP_TOOL_PROFILE_HEADER]: "compact" },
    });
    const result = await client.call("catalog_read", {
      resource: "web_notes",
      operation: "list",
    });
    expect(result.isError).toBeUndefined();
    expect(calls.map((call) => call.path)).toEqual(["/api/admin/notes"]);
  });
});

describe("boundaries", () => {
  test("every operation is refused by the other kinds' call tools before reaching upstream", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    for (const op of operations) {
      for (const [kind, tool] of Object.entries(MCP_CATALOG_CALL_TOOLS)) {
        if (kind === op.kind) continue;
        const result = await client.call(tool, {
          resource: op.resource,
          operation: op.operation,
          args: {},
        });
        expect(
          result.isError,
          `${op.resource} ${op.operation} via ${tool}`,
        ).toBe(true);
        expect(result.structuredContent?.error).toMatchObject({
          code: "WRONG_TOOL",
          kind: op.kind,
        });
      }
    }
    expect(calls).toEqual([]);
  }, 120_000);

  test("a direct tool is never reachable through the catalog", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    for (const name of Object.keys(DIRECT_TOOLS)) {
      for (const tool of Object.values(MCP_CATALOG_CALL_TOOLS)) {
        const result = await client.call(tool, { resource: name, args: {} });
        expect(result.structuredContent?.error).toMatchObject({
          code: "DIRECT_TOOL",
        });
      }
    }
    expect(calls).toEqual([]);
  });

  test("unknown resources and operations are refused with what exists", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    const unknown = await client.call("catalog_read", {
      resource: "web_note",
      operation: "list",
    });
    expect(unknown.structuredContent).toMatchObject({
      status: 404,
      error: { code: "UNKNOWN_RESOURCE" },
    });
    const { suggestions } = z
      .object({ suggestions: z.array(z.string()) })
      .parse(unknown.structuredContent?.error);
    expect(suggestions[0]).toBe("web_notes");

    const operation = await client.call("catalog_read", {
      resource: "web_notes",
      operation: "drop",
    });
    expect(operation.structuredContent?.error).toMatchObject({
      code: "UNKNOWN_OPERATION",
      operations: expect.arrayContaining(["list", "delete"]),
    });

    const missing = await client.call("catalog_read", {
      resource: "web_notes",
    });
    expect(missing.structuredContent?.error).toMatchObject({
      code: "OPERATION_REQUIRED",
    });

    const malformed = await client.call("catalog_read", { operation: "list" });
    expect(malformed.structuredContent?.error).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(calls).toEqual([]);
  });

  test("invalid arguments come back with the operation's schema", async () => {
    const { upstream, calls } = recordingUpstream();
    const result = await createClient(upstream).call("catalog_write", {
      resource: "web_notes",
      operation: "rename",
      args: { noteId: "n1" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: "INVALID_INPUT",
      resource: "web_notes",
      operation: "rename",
      inputSchema: {
        type: "object",
        required: expect.arrayContaining(["noteId", "name"]),
      },
    });
    expect(calls).toEqual([]);
  });
});

const searchResult = z.object({
  resources: z.array(
    z.object({
      resource: z.string(),
      operations: z.record(z.string(), z.string()),
    }),
  ),
});

describe("discovery", () => {
  test("search ranks by name, filters, and pages", async () => {
    const { upstream } = recordingUpstream();
    const client = createClient(upstream);
    const found = await client.call("catalog_search", {
      query: "kanban cards",
    });
    const resources = searchResult.parse(found.structuredContent).resources;
    expect(resources[0]?.resource).toBe("web_kanban_cards");
    expect(resources[0]?.operations.delete).toStartWith("destructive(");

    const page = await client.call("catalog_search", {
      app: "forge",
      limit: 5,
    });
    expect(page.structuredContent).toMatchObject({ nextCursor: 5 });
    const names = searchResult
      .parse(page.structuredContent)
      .resources.map((entry) => entry.resource);
    expect(names).toHaveLength(5);
    expect(names.every((name) => name.startsWith("forge_"))).toBe(true);
    expect(names).not.toContain("forge_resource_credentials_reveal");
  });

  test("describe gives every operation a schema and the tool that runs it", async () => {
    const { upstream } = recordingUpstream();
    const client = createClient(upstream);
    for (const tool of catalogTools) {
      const described = await client.call("catalog_describe", {
        resource: tool.name,
      });
      expect(described.isError, tool.name).toBeUndefined();
      expect(described.content[0]?.text.length ?? 0).toBeLessThanOrEqual(
        48_000,
      );
    }
    const one = await client.call("catalog_describe", {
      resource: "web_workspace_blocks",
      operation: "apply",
    });
    const [operation] = z
      .object({
        operations: z.array(
          z.object({
            callWith: z.string(),
            inputSchema: z.object({ type: z.string() }),
          }),
        ),
      })
      .parse(one.structuredContent).operations;
    expect(operation?.callWith).toBe("catalog_write");
    expect(operation?.inputSchema.type).toBe("object");
  });
});
