import { describe, expect, test } from "bun:test";
import { MCP_ACTIONS_META_KEY, mcpActionsMetaSchema } from "@repo/schemas";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { DIRECT_TOOLS } from "../surface";
import { registerWebWorkspaceSurfaces } from "./workspace-surfaces";

const register: ToolRegistrar = (server, upstream) =>
  registerWebWorkspaceSurfaces(server, createApi(upstream));

const { upstream, calls } = recordingUpstream((call) =>
  call.method === "GET" && /surfaces\/[a-f0-9]{24}$/.test(call.path)
    ? Response.json({ surface: { id: "x", state: { score: 3 }, errors: [] } })
    : Response.json({ ok: true }),
);
const client = createClient(upstream, register);

const ID = "0123456789abcdef01234567";
const SURFACES = "/api/admin/workspace/surfaces";

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

async function expectCall(
  args: Record<string, unknown>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const result = await client.call("web_workspace_surfaces", args);
  expect(result.isError).toBeFalsy();
  expect(last().method).toBe(method);
  expect(last().path).toBe(path);
  if (body) expect(JSON.parse(last().body ?? "null")).toEqual(body);
}

describe("web_workspace_surfaces", () => {
  test("every action reaches its route", async () => {
    await expectCall({ action: "list" }, "GET", SURFACES);
    await expectCall({ action: "get", id: ID }, "GET", `${SURFACES}/${ID}`);
    await expectCall(
      { action: "get", id: ID, includeSource: false },
      "GET",
      `${SURFACES}/${ID}?includeSource=false`,
    );
    await expectCall(
      { action: "source_read", id: ID, field: "js" },
      "POST",
      `${SURFACES}/${ID}/source`,
      {
        action: "source_read",
        field: "js",
        startLine: 1,
        offset: 0,
        maxChars: 12000,
      },
    );
    await expectCall(
      { action: "source_search", id: ID, query: "refresh" },
      "POST",
      `${SURFACES}/${ID}/source`,
      {
        action: "source_search",
        query: "refresh",
        offset: 0,
        limit: 20,
      },
    );
    const edits = [{ field: "js", oldText: "a", newText: "b" }];
    await expectCall(
      { action: "source_edit", id: ID, baseRev: 2, edits },
      "POST",
      `${SURFACES}/${ID}/source`,
      {
        action: "source_edit",
        baseRev: 2,
        edits,
      },
    );
    const sources = [{ field: "js", sourceUrl: "https://files.test/app.js" }];
    await expectCall(
      { action: "source_import", id: ID, baseRev: 2, sources },
      "POST",
      `${SURFACES}/${ID}/source`,
      {
        action: "source_import",
        baseRev: 2,
        sources,
      },
    );
    await expectCall({ action: "create", name: "Santa" }, "POST", SURFACES);
    await expectCall(
      { action: "update", id: ID, js: "1" },
      "PATCH",
      `${SURFACES}/${ID}`,
      { js: "1" },
    );
    await expectCall(
      { action: "delete", id: ID },
      "DELETE",
      `${SURFACES}/${ID}`,
    );
    await expectCall(
      { action: "history", id: ID, limit: 5 },
      "GET",
      `${SURFACES}/${ID}/history?limit=5`,
    );
    await expectCall(
      { action: "revert", id: ID, rev: 2 },
      "POST",
      `${SURFACES}/${ID}/revert`,
      { rev: 2 },
    );
    await expectCall(
      {
        action: "mount",
        id: ID,
        mount: { kind: "module", module: "notes" },
        chrome: "sidebar",
      },
      "PATCH",
      `${SURFACES}/${ID}`,
      { mount: { kind: "module", module: "notes" }, chrome: "sidebar" },
    );
    await expectCall(
      {
        action: "asset_add",
        id: ID,
        name: "a.png",
        contentType: "image/png",
        dataBase64: "AAAA",
      },
      "POST",
      `${SURFACES}/${ID}/assets`,
      { name: "a.png", contentType: "image/png", dataBase64: "AAAA" },
    );
    await expectCall(
      { action: "asset_remove", id: ID, name: "a.png" },
      "DELETE",
      `${SURFACES}/${ID}/assets/a.png`,
    );
    await expectCall(
      { action: "state_set", id: ID, state: { a: 1 } },
      "PUT",
      `${SURFACES}/${ID}/state`,
      { state: { a: 1 } },
    );
    await expectCall(
      { action: "errors_clear", id: ID },
      "DELETE",
      `${SURFACES}/${ID}/errors`,
    );
  });

  test("state_get returns only the state", async () => {
    const result = await client.call("web_workspace_surfaces", {
      action: "state_get",
      id: ID,
    });
    expect(result.structuredContent).toEqual({ state: { score: 3 } });
  });

  test("an asset with neither bytes nor a url is refused before upstream", async () => {
    const before = calls.length;
    const result = await client.call("web_workspace_surfaces", {
      action: "asset_add",
      id: ID,
      name: "a.png",
    });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  test("kinds are marked and the tool is direct", async () => {
    const tool = (await client.listTools()).find(
      (t) => t.name === "web_workspace_surfaces",
    );
    const flags = mcpActionsMetaSchema.parse(
      tool?._meta?.[MCP_ACTIONS_META_KEY],
    );
    for (const name of [
      "list",
      "get",
      "history",
      "state_get",
      "source_read",
      "source_search",
    ]) {
      expect(flags[name]?.readOnly).toBe(true);
    }
    for (const name of ["delete", "asset_remove"]) {
      expect(flags[name]?.destructive).toBe(true);
      expect(flags[name]?.readOnly).toBe(false);
    }
    for (const name of [
      "create",
      "update",
      "mount",
      "revert",
      "state_set",
      "source_edit",
      "source_import",
    ]) {
      expect(flags[name]?.readOnly).toBe(false);
      expect(flags[name]?.destructive).toBeFalsy();
    }
    expect(Object.hasOwn(DIRECT_TOOLS, "web_workspace_surfaces")).toBe(true);
  });

  test("invalid source requests never reach upstream", async () => {
    for (const input of [
      {
        action: "source_edit",
        id: ID,
        edits: [{ field: "js", oldText: "a", newText: "b" }],
      },
      { action: "source_read", id: ID, field: "js", startLine: 4, endLine: 2 },
      {
        action: "source_import",
        id: ID,
        baseRev: 1,
        sources: [{ field: "js", sourceUrl: "http://files.test/a" }],
      },
    ]) {
      const before = calls.length;
      const result = await client.call("web_workspace_surfaces", input);
      expect(result.isError).toBe(true);
      expect(calls.length).toBe(before);
    }
  });
});
