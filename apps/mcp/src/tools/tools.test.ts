import { describe, expect, test } from "bun:test";
import { TOOL_NAME } from "./define";
import { createClient, recordingUpstream } from "./harness.test-util";

describe("tool registry", () => {
  test("every tool has a unique, conventional name and an object schema", async () => {
    const { upstream } = recordingUpstream();
    const tools = await createClient(upstream).listTools();
    expect(tools.length).toBeGreaterThan(150);
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      if (tool.name === "whoami") continue;
      expect(tool.name).toMatch(TOOL_NAME);
      expect(tool.name.length).toBeLessThanOrEqual(64);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("covers every app", async () => {
    const { upstream } = recordingUpstream();
    const tools = await createClient(upstream).listTools();
    const byApp = new Map<string, number>();
    for (const tool of tools) {
      const app = tool.name.split("_")[0] ?? "";
      byApp.set(app, (byApp.get(app) ?? 0) + 1);
    }
    expect(byApp.get("forge")).toBeGreaterThanOrEqual(60);
    expect(byApp.get("cloud")).toBeGreaterThanOrEqual(70);
    expect(byApp.get("storage")).toBeGreaterThanOrEqual(18);
  });

  test("an action tool advertises its actions and marks fields with them", async () => {
    const { upstream } = recordingUpstream();
    const tools = await createClient(upstream).listTools();
    const tool = tools.find(
      (entry) => entry.name === "forge_deployment_action",
    );
    expect(tool).toBeDefined();
    const action = tool?.inputSchema.properties?.action as { enum?: string[] };
    expect(action.enum).toEqual([
      "cancel",
      "retry",
      "rollback",
      "promote",
      "restart",
      "delete",
    ]);
    expect(tool?.inputSchema.required).toEqual(["action"]);
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("routing", () => {
  test("GET tools encode ids and pass query parameters", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    await client.call("forge_deployments_list", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
      page: 2,
      limit: 10,
    });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.path).toBe(
      "/api/deploy/targets/7f1a0c52-0000-4000-8000-000000000001/deployments?page=2&limit=10",
    );

    await client.call("cloud_pg_tables_list", {
      database: "cloud",
      schema: "audit",
    });
    expect(calls[1]?.path).toBe(
      "/api/db/postgres/databases/cloud/tables?schema=audit",
    );

    await client.call("forge_deployments_search", {
      status: ["ready", "failed"],
      limit: 5,
    });
    expect(calls[2]?.path).toBe(
      "/api/forge/deployments?limit=5&offset=0&sort=createdAt&direction=desc&status=ready&status=failed",
    );
  });

  test("mutations send JSON bodies without the path fields", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    await client.call("forge_target_update", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
      name: "renamed",
    });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.path).toBe(
      "/api/deploy/targets/7f1a0c52-0000-4000-8000-000000000001",
    );
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "renamed" });
  });

  test("action tools route by action and validate per action", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    const refused = await client.call("forge_deployment_action", {
      action: "delete",
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("INVALID_INPUT");
    expect(calls).toHaveLength(0);

    await client.call("forge_deployment_action", {
      action: "delete",
      deploymentId: "7f1a0c52-0000-4000-8000-000000000002",
    });
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.path).toBe(
      "/api/deploy/deployments/7f1a0c52-0000-4000-8000-000000000002",
    );

    await client.call("cloud_storage_report", {
      action: "largest_files",
      limit: 3,
    });
    expect(calls[1]?.path).toBe("/api/ops/storage/largest-files?limit=3");
  });

  test("upstream errors come back as isError with the body", async () => {
    const { upstream } = recordingUpstream(() =>
      Response.json(
        { error: { code: "NOT_FOUND", message: "no" } },
        { status: 404 },
      ),
    );
    const result = await createClient(upstream).call("forge_target_get", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 404,
      error: { error: { code: "NOT_FOUND", message: "no" } },
    });
  });
});

describe("forge env helpers", () => {
  const stored = {
    data: [
      {
        id: "1",
        key: "A",
        source: "literal",
        reference: null,
        template: null,
        hasValue: true,
        scope: "all",
        environmentId: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "2",
        key: "DB",
        source: "binding",
        reference: "res:1:url",
        template: null,
        hasValue: true,
        scope: "production",
        environmentId: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };

  test("set upserts on key+scope+environment and keeps stored literals", async () => {
    const { upstream, calls } = recordingUpstream((call) =>
      call.method === "GET"
        ? Response.json(stored)
        : Response.json({ data: { count: 2 } }),
    );
    await createClient(upstream).call("forge_env_set", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
      vars: [{ key: "A", source: "literal", value: "new", scope: "all" }],
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      vars: [
        {
          key: "DB",
          scope: "production",
          environmentId: null,
          source: "binding",
          reference: "res:1:url",
        },
        { key: "A", source: "literal", value: "new", scope: "all" },
      ],
    });
  });

  test("unset removes only the named keys and skips the PUT when nothing matches", async () => {
    const { upstream, calls } = recordingUpstream((call) =>
      call.method === "GET"
        ? Response.json(stored)
        : Response.json({ data: { count: 1 } }),
    );
    const client = createClient(upstream);
    const untouched = await client.call("forge_env_unset", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
      keys: ["NOPE"],
    });
    expect(untouched.structuredContent?.removed).toBe(0);
    expect(calls.map((call) => call.method)).toEqual(["GET"]);

    const removed = await client.call("forge_env_unset", {
      targetId: "7f1a0c52-0000-4000-8000-000000000001",
      keys: ["DB"],
    });
    expect(removed.structuredContent?.removed).toBe(1);
    expect(JSON.parse(calls[2]?.body ?? "{}").vars).toHaveLength(1);
  });
});

describe("storage", () => {
  test("upload creates a tus upload with base64 metadata then patches the bytes", async () => {
    const { upstream, calls } = recordingUpstream((call) => {
      if (call.method === "GET") {
        return Response.json({ data: { id: "f", path: "/users/u1/Docs" } });
      }
      if (call.method === "POST") {
        return new Response(null, {
          status: 201,
          headers: {
            location: "/api/storage/uploads/up-1",
            "upload-offset": "0",
          },
        });
      }
      return new Response(null, {
        status: 204,
        headers: { "upload-offset": "5" },
      });
    });
    const result = await createClient(upstream).call("storage_upload", {
      folderId: "7f1a0c52-0000-4000-8000-000000000003",
      filename: "hello.txt",
      text: "hello",
      contentType: "text/plain",
    });
    expect(result.isError).toBeUndefined();
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "PATCH"]);
    const metadata = calls[1]?.headers["upload-metadata"] ?? "";
    expect(metadata).toContain(
      `filename ${Buffer.from("hello.txt").toString("base64")}`,
    );
    expect(metadata).toContain(
      `targetFolder ${Buffer.from("/users/u1/Docs").toString("base64")}`,
    );
    expect(calls[1]?.headers["upload-length"]).toBe("5");
    expect(calls[2]?.path).toBe("/api/storage/uploads/up-1");
    expect(calls[2]?.headers["content-type"]).toBe(
      "application/offset+octet-stream",
    );
    expect(calls[2]?.body).toBe("hello");
    expect(result.structuredContent?.path).toBe("/users/u1/Docs/hello.txt");
  });

  test("read returns text for text files and metadata only for binaries", async () => {
    const { upstream } = recordingUpstream((call) =>
      call.path.includes("000000000004")
        ? new Response("line one\nline two", {
            headers: { "content-type": "text/plain", "content-length": "17" },
          })
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/png", "content-length": "3" },
          }),
    );
    const client = createClient(upstream);
    const text = await client.call("storage_file_read", {
      fileId: "7f1a0c52-0000-4000-8000-000000000004",
    });
    expect(text.structuredContent).toEqual({
      contentType: "text/plain",
      size: 17,
      text: "line one\nline two",
      truncated: false,
    });
    const binary = await client.call("storage_file_read", {
      fileId: "7f1a0c52-0000-4000-8000-000000000005",
    });
    expect(binary.structuredContent).toEqual({
      contentType: "image/png",
      size: 3,
      text: null,
      binary: true,
    });
    const encoded = await client.call("storage_file_read", {
      fileId: "7f1a0c52-0000-4000-8000-000000000005",
      encoding: "base64",
    });
    expect(encoded.structuredContent?.base64).toBe(
      Buffer.from([1, 2, 3]).toString("base64"),
    );
  });
});

describe("cloud_run_command", () => {
  test("creates a parked one-off, triggers it and polls to a terminal run", async () => {
    let polls = 0;
    const { upstream, calls } = recordingUpstream((call) => {
      if (call.method === "POST" && call.path === "/api/ops/tasks") {
        return Response.json({ data: { id: "task-1" } }, { status: 201 });
      }
      if (call.method === "POST" && call.path.endsWith("/run")) {
        return Response.json(
          { data: { id: "run-1", status: "running" } },
          { status: 202 },
        );
      }
      polls += 1;
      return Response.json({
        data: [
          {
            id: "run-1",
            status: polls > 1 ? "completed" : "running",
            output: "stdout:\nhi\n",
            metadata: { exitCode: 0 },
          },
        ],
      });
    });
    const result = await createClient(upstream).call("cloud_run_command", {
      command: "echo",
      args: ["hi"],
      waitMs: 10_000,
    });
    expect(result.structuredContent?.finished).toBe(true);
    expect(result.structuredContent?.exitCode).toBe(0);
    expect(result.structuredContent?.output).toBe("stdout:\nhi\n");
    const created = JSON.parse(calls[0]?.body ?? "{}");
    expect(created.type).toBe("run_command");
    expect(created.config).toMatchObject({ command: "echo", args: ["hi"] });
    expect(new Date(created.scheduledAt).getTime()).toBeGreaterThan(
      Date.now() + 300 * 24 * 3600 * 1000,
    );
    expect(calls[1]?.path).toBe("/api/ops/tasks/task-1/run");
  });
});

describe("log streams", () => {
  test("build logs parse SSE and stop on the end event", async () => {
    const { upstream } = recordingUpstream(
      () =>
        new Response("data: one\n\ndata: two\n\nevent: end\ndata: \n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const result = await createClient(upstream).call(
      "forge_deployment_build_logs",
      {
        deploymentId: "7f1a0c52-0000-4000-8000-000000000002",
        maxMs: 1_000,
      },
    );
    expect(result.structuredContent).toEqual({
      lines: ["one", "two"],
      complete: true,
      truncated: false,
    });
  });
});

describe("web content", () => {
  test("action tools map to the admin routes", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    await client.call("web_blogs", { action: "toggle", id: "b1" });
    expect(calls[0]?.side).toBe("web");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.path).toBe("/api/admin/blogs/b1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ toggleActive: true });

    await client.call("web_contacts", {
      action: "set_status",
      ticketId: "t/1",
      status: "read",
    });
    expect(calls[1]?.path).toBe("/api/admin/contacts/t%2F1");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ status: "read" });

    await client.call("web_timeline", { action: "list", category: "work" });
    expect(calls[2]?.path).toBe("/api/admin/timeline?category=work");

    await client.call("web_projects", {
      action: "reorder",
      items: [{ _id: "p1", order: 2 }],
    });
    expect(calls[3]?.method).toBe("PATCH");
    expect(calls[3]?.path).toBe("/api/admin/projects/reorder");

    const refused = await client.call("web_comments", { action: "approve" });
    expect(refused.isError).toBe(true);
    expect(calls).toHaveLength(4);
  });
});

describe("forge commit messages", () => {
  const message = "feat(mcp): add tools\r\n\nA long body\nover lines.";
  const target = {
    id: "t1",
    latestDeployment: { id: "d1", gitMessage: message },
    latestProduction: { id: "d0", gitMessage: null },
  };

  test("list tools cut every commit message to its subject line", async () => {
    const { upstream } = recordingUpstream(() =>
      Response.json({ data: [target] }),
    );
    const result = await createClient(upstream).call("forge_targets_list");
    expect(result.structuredContent?.data).toEqual([
      {
        id: "t1",
        latestDeployment: { id: "d1", gitMessage: "feat(mcp): add tools" },
        latestProduction: { id: "d0", gitMessage: null },
      },
    ]);
    expect(result.content[0]?.text).not.toContain("A long body");
  });

  test("the single-deployment read keeps the full message", async () => {
    const { upstream } = recordingUpstream(() =>
      Response.json({ data: { id: "d1", gitMessage: message } }),
    );
    const result = await createClient(upstream).call("forge_deployment_get", {
      deploymentId: "7f1a0c52-0000-4000-8000-000000000002",
    });
    expect(result.structuredContent?.data).toEqual({
      id: "d1",
      gitMessage: message,
    });
  });

  test("an upstream error passes through untouched", async () => {
    const { upstream } = recordingUpstream(() =>
      Response.json({ error: { code: "BOOM" } }, { status: 502 }),
    );
    const result = await createClient(upstream).call(
      "forge_deployments_search",
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 502,
      error: { error: { code: "BOOM" } },
    });
  });
});
