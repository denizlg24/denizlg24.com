import { describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { registerWebWorkspace } from "./workspace";

const register: ToolRegistrar = (server, upstream) =>
  registerWebWorkspace(server, createApi(upstream));

const { upstream, calls } = recordingUpstream((call) =>
  call.path.endsWith("/ops") && call.body?.includes('"baseRev":1')
    ? Response.json(
        { error: "conflict", code: "CONFLICT", conflicts: ["a"] },
        { status: 409 },
      )
    : call.path.endsWith("/views/query")
      ? Response.json({
          source: "kanban-cards",
          rows: [],
          total: 0,
          options: { column: ["Todo", "Done"] },
          totals: [],
        })
      : Response.json({ ok: true }),
);
const client = createClient(upstream, register);

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

async function expectCall(
  name: string,
  args: Record<string, unknown>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const result = await client.call(name, args);
  expect(result.isError).toBeFalsy();
  expect(last().method).toBe(method);
  expect(last().path).toBe(path);
  if (body) expect(JSON.parse(last().body ?? "null")).toEqual(body);
}

const PAGES = "/api/admin/workspace/pages";

describe("web_workspace_pages", () => {
  test("every action reaches its route", async () => {
    await expectCall("web_workspace_pages", { action: "list" }, "GET", PAGES);
    await expectCall(
      "web_workspace_pages",
      { action: "get", id: "home" },
      "GET",
      `${PAGES}/home`,
    );
    await expectCall(
      "web_workspace_pages",
      { action: "create", title: "Plan", markdown: "## Week" },
      "POST",
      PAGES,
      {
        title: "Plan",
        markdown: "## Week",
        icon: null,
        parentId: null,
        blocks: [],
        fullWidth: false,
        locked: false,
      },
    );
    await expectCall(
      "web_workspace_pages",
      { action: "update", id: "p1", title: "Renamed" },
      "PATCH",
      `${PAGES}/p1`,
      { title: "Renamed" },
    );
    await expectCall(
      "web_workspace_pages",
      { action: "move", id: "p1", parentId: "home", index: 0 },
      "POST",
      `${PAGES}/p1/move`,
      { parentId: "home", index: 0 },
    );
    await expectCall(
      "web_workspace_pages",
      { action: "archive", id: "p1" },
      "POST",
      `${PAGES}/p1/archive`,
    );
    await expectCall(
      "web_workspace_pages",
      { action: "restore", id: "p1" },
      "POST",
      `${PAGES}/p1/restore`,
    );
    await expectCall(
      "web_workspace_pages",
      { action: "to_markdown", id: "p1" },
      "GET",
      `${PAGES}/p1/markdown`,
    );
    await expectCall(
      "web_workspace_pages",
      { action: "from_markdown", id: "p1", baseRev: 4, markdown: "x" },
      "PUT",
      `${PAGES}/p1/markdown`,
      { baseRev: 4, markdown: "x" },
    );
    await expectCall(
      "web_workspace_pages",
      { action: "history", id: "p1", limit: 5 },
      "GET",
      `${PAGES}/p1/history?limit=5`,
    );
    await expectCall(
      "web_workspace_pages",
      { action: "revert", id: "p1", actor: "conversation:c1" },
      "POST",
      `${PAGES}/p1/revert`,
      { actor: "conversation:c1" },
    );
    await expectCall(
      "web_workspace_pages",
      { action: "changes", since: "2026-10-29T00:00:00.000Z" },
      "GET",
      "/api/admin/workspace/changes?since=2026-10-29T00%3A00%3A00.000Z",
    );
  });

  test("reads are marked read-only and writes are not", async () => {
    const tools = await client.listTools();
    const pages = tools.find((t) => t.name === "web_workspace_pages");
    const blocks = tools.find((t) => t.name === "web_workspace_blocks");
    const flags = pages?._meta?.["com.denizlg24/actions"] as Record<
      string,
      { readOnly: boolean }
    >;
    for (const name of ["list", "get", "to_markdown", "history", "changes"]) {
      expect(flags[name]?.readOnly).toBe(true);
    }
    for (const name of [
      "create",
      "update",
      "move",
      "archive",
      "from_markdown",
      "revert",
    ]) {
      expect(flags[name]?.readOnly).toBe(false);
    }
    const blockFlags = blocks?._meta?.["com.denizlg24/actions"] as Record<
      string,
      { readOnly: boolean }
    >;
    expect(blockFlags.get?.readOnly).toBe(true);
    expect(blockFlags.apply?.readOnly).toBe(false);
  });
});

describe("web_workspace_blocks", () => {
  test("apply posts the batch; a conflict is an error result, never a throw", async () => {
    await expectCall(
      "web_workspace_blocks",
      {
        action: "apply",
        id: "home",
        baseRev: 3,
        ops: [{ op: "update", id: "a", set: { markdown: "x" } }],
      },
      "POST",
      `${PAGES}/home/ops`,
      {
        baseRev: 3,
        ops: [{ op: "update", id: "a", set: { markdown: "x" } }],
      },
    );
    const conflict = await client.call("web_workspace_blocks", {
      action: "apply",
      id: "home",
      baseRev: 1,
      ops: [{ op: "delete", id: "a" }],
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ status: 409 });
  });

  test("nested inserts and moves carry parentId and whole subtrees", async () => {
    const toggle = {
      id: "t",
      type: "toggle",
      text: [{ type: "text", text: "More", bold: true }],
      children: [
        {
          id: "p",
          type: "paragraph",
          text: [{ type: "mention", kind: "person", id: "ana", label: "Ana" }],
        },
      ],
    };
    await expectCall(
      "web_workspace_blocks",
      {
        action: "apply",
        id: "home",
        baseRev: 3,
        ops: [
          { op: "insert", block: toggle, parentId: "col1", after: null },
          { op: "move", id: "a", parentId: "t", after: "p" },
          { op: "update", id: "b", set: {}, type: "heading" },
        ],
      },
      "POST",
      `${PAGES}/home/ops`,
      {
        baseRev: 3,
        ops: [
          { op: "insert", block: toggle, parentId: "col1", after: null },
          { op: "move", id: "a", parentId: "t", after: "p" },
          { op: "update", id: "b", set: {}, type: "heading" },
        ],
      },
    );
  });

  test("an invalid op is refused before anything reaches web", async () => {
    const before = calls.length;
    const result = await client.call("web_workspace_blocks", {
      action: "apply",
      id: "home",
      baseRev: 1,
      ops: [{ op: "explode", id: "a" }],
    });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  test("the in-app agent's actor header is forwarded to web", async () => {
    const agent = createClient(upstream, register, {
      headers: { "x-agent-actor": "conversation:c42" },
    });
    await agent.call("web_workspace_blocks", { action: "get", id: "home" });
    expect(last().headers["x-agent-actor"]).toBe("conversation:c42");

    const spoofed = createClient(upstream, register, {
      headers: { "x-agent-actor": "owner" },
    });
    await spoofed.call("web_workspace_blocks", { action: "get", id: "home" });
    expect(last().headers["x-agent-actor"]).toBeUndefined();
  });
});

describe("web_workspace_records and web_workspace_views", () => {
  test("records resolve and search through the records routes", async () => {
    await expectCall(
      "web_workspace_records",
      { action: "resolve", refs: ["entity:note:n1", "entity:page:home"] },
      "GET",
      `/api/admin/workspace/records?refs=${encodeURIComponent("entity:note:n1,entity:page:home")}`,
    );
    await expectCall(
      "web_workspace_records",
      { action: "search", q: "raft", kind: ["paper"] },
      "GET",
      "/api/admin/workspace/records/search?q=raft&kind=paper",
    );
  });

  test("sources answer locally with every field and operator", async () => {
    const before = calls.length;
    const result = await client.call("web_workspace_views", {
      action: "sources",
    });
    expect(calls.length).toBe(before);
    const sources = result.structuredContent?.sources;
    expect(sources && typeof sources === "object" && "triage" in sources).toBe(
      true,
    );
  });

  test("query reads at most 50 rows and drops the select options", async () => {
    const result = await client.call("web_workspace_views", {
      action: "query",
      view: { source: "kanban-cards", limit: 200 },
    });
    expect(result.isError).toBeFalsy();
    expect(last().path).toBe("/api/admin/workspace/views/query");
    const body = JSON.parse(last().body ?? "null");
    expect(body.limit).toBe(50);
    expect(body.view.source).toBe("kanban-cards");
    expect(result.structuredContent?.options).toBeUndefined();
    expect(result.structuredContent?.total).toBe(0);

    await client.call("web_workspace_views", {
      action: "query",
      pageId: "home",
      blockId: "v1",
    });
    expect(JSON.parse(last().body ?? "null")).toEqual({
      pageId: "home",
      blockId: "v1",
      limit: 25,
    });
  });

  test("view actions are read-only and a view block is accepted by apply", async () => {
    const tools = await client.listTools();
    const views = tools.find((t) => t.name === "web_workspace_views");
    expect(views?._meta?.["com.denizlg24/actions"]).toMatchObject({
      sources: { readOnly: true },
      query: { readOnly: true },
    });
    await expectCall(
      "web_workspace_blocks",
      {
        action: "apply",
        id: "home",
        baseRev: 4,
        ops: [
          {
            op: "insert",
            block: {
              id: "v1",
              type: "view",
              source: "finance-entries",
              layout: "table",
              filters: [{ field: "currency", op: "is", value: "EUR" }],
            },
          },
          {
            op: "insert",
            block: { id: "r1", type: "record", ref: "entity:paper:p1" },
          },
        ],
      },
      "POST",
      `${PAGES}/home/ops`,
    );
  });
});
