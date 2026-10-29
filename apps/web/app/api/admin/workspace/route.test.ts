import { describe, expect, mock, test } from "bun:test";
import type { Workspace, WorkspacePageDoc } from "@repo/schemas";
import { NextRequest } from "next/server";
import type { AdminSession } from "@/lib/require-admin";
import { memoryWorkspaceRepo } from "@/lib/workspace/memory-repo.test-util";

const legacy: Workspace = {
  version: 1,
  savedAt: "2026-10-20T10:00:00.000Z",
  pages: {
    home: {
      id: "home",
      title: "Home",
      icon: null,
      parentId: null,
      order: 0,
      blocks: [
        { id: "a", span: 6, type: "text", markdown: "a" },
        { id: "b", span: 6, type: "text", markdown: "b" },
      ],
      fullWidth: false,
      locked: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
    },
  },
  favorites: [],
  recents: [],
  sidebar: {
    width: 248,
    collapsed: false,
    hiddenModules: [],
    collapsedSections: [],
    expandedPages: [],
  },
};

const memory = memoryWorkspaceRepo(legacy);
let session: AdminSession = {
  user: { email: "owner", role: "admin" },
  via: "session",
};

mock.module("@/lib/require-admin", () => ({
  getAdminSession: mock(async () => session),
}));
mock.module("@/lib/mongodb", () => ({ connectDB: mock(async () => {}) }));
mock.module("@/lib/workspace/mongo-repo", () => ({
  mongoWorkspaceRepo: memory.repo,
}));

const { GET, PUT } = await import("./route");
const ops = await import("./pages/[id]/ops/route");

const url = "http://localhost/api/admin/workspace";
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "PUT",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...headers },
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/admin/workspace (desktop 3.0.0)", () => {
  test("GET migrates on first use and serves the whole document", async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    const { workspace } = (await response.json()) as { workspace: Workspace };
    expect(workspace.pages.home?.blocks).toEqual(
      legacy.pages.home?.blocks ?? [],
    );
    expect(memory.pages.get("home")?.rev).toBe(1);
  });

  test("an agent's op lands attributed, and a stale PUT keeps it", async () => {
    const held = (
      (await (await GET(new NextRequest(url))).json()) as {
        workspace: Workspace;
      }
    ).workspace;

    session = {
      user: { email: "client:mcp-svc", role: "admin" },
      via: "oauth",
    };
    const edited = await ops.POST(
      new NextRequest(
        `${url}/pages/home/ops`,
        json(
          {
            baseRev: 1,
            ops: [{ op: "update", id: "a", set: { markdown: "agent" } }],
          },
          { "x-agent-actor": "conversation:c42" },
        ),
      ),
      params("home"),
    );
    expect(edited.status).toBe(200);
    const { page } = (await edited.json()) as { page: WorkspacePageDoc };
    expect(page.rev).toBe(2);
    expect(memory.revisions.at(-1)).toMatchObject({
      actor: "conversation:c42",
      via: "mcp:mcp-svc",
    });

    session = { user: { email: "owner", role: "admin" }, via: "session" };
    const home = held.pages.home;
    if (!home) throw new Error("home missing");
    const put = await PUT(
      new NextRequest(
        url,
        json({
          ...held,
          pages: {
            home: {
              ...home,
              blocks: [
                { id: "a", span: 6, type: "text", markdown: "a" },
                { id: "b", span: 6, type: "text", markdown: "desktop" },
              ],
            },
          },
        }),
      ),
    );
    expect(put.status).toBe(200);
    expect(memory.pages.get("home")?.blocks).toEqual([
      { id: "a", span: 6, type: "text", markdown: "agent" },
      { id: "b", span: 6, type: "text", markdown: "desktop" },
    ]);
  });

  test("a stale op on the same block is a 409 carrying the current page", async () => {
    const response = await ops.POST(
      new NextRequest(
        `${url}/pages/home/ops`,
        json({ baseRev: 1, ops: [{ op: "delete", id: "a" }] }),
      ),
      params("home"),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      code: string;
      conflicts: string[];
      page: WorkspacePageDoc;
    };
    expect(body.code).toBe("CONFLICT");
    expect(body.conflicts).toEqual(["a"]);
    expect(body.page.rev).toBe(3);
  });

  test("an invalid body is a 400", async () => {
    const response = await PUT(new NextRequest(url, json({ version: 2 })));
    expect(response.status).toBe(400);
  });
});
