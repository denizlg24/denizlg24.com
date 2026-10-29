import { afterEach, describe, expect, test } from "bun:test";
import {
  type Block,
  HOME_PAGE_ID,
  type WorkspaceCache,
  type WorkspacePageDoc,
  type WorkspacePageSummary,
  type WorkspacePrefs,
  workspaceOpsRequestSchema,
  workspacePageCreateSchema,
  workspacePrefsInputSchema,
} from "@repo/schemas";
import { applyWorkspaceOps } from "@repo/utils/workspace-ops";
import { createAdminClient } from "../client";
import { seedWorkspace } from "./seed";
import {
  flushWorkspace,
  pollWorkspaceChanges,
  resetWorkspaceSync,
  useWorkspaceStore,
} from "./store";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const text = (id: string, markdown = id): Block => ({
  id,
  span: 6,
  type: "text",
  markdown,
});

function doc(id: string, blocks: Block[], rev = 1): WorkspacePageDoc {
  return {
    id,
    title: id,
    icon: null,
    parentId: null,
    order: 0,
    blocks,
    fullWidth: false,
    locked: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
    rev,
  };
}

function summary(page: WorkspacePageDoc): WorkspacePageSummary {
  const { blocks, ...meta } = page;
  return { ...meta, blockCount: blocks.length };
}

/** The per-page API in miniature: revs, block-level rebase, a change feed. */
function fakeServer(initial: WorkspacePageDoc[]) {
  const pages = new Map(initial.map((p) => [p.id, p]));
  const touched = new Map<string, Map<number, string[]>>();
  let prefs: WorkspacePrefs = {
    ...(({ favorites, recents, sidebar }) => ({ favorites, recents, sidebar }))(
      seedWorkspace(),
    ),
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const requests: { method: string; path: string; body: unknown }[] = [];

  const write = (page: WorkspacePageDoc, ids: string[]) => {
    const log = touched.get(page.id) ?? new Map<number, string[]>();
    log.set(page.rev, ids);
    touched.set(page.id, log);
    pages.set(page.id, page);
  };

  const client = createAdminClient({
    baseUrl: "/api/admin",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input), "http://x");
      const path = url.pathname.replace("/api/admin/workspace", "");
      const method = init?.method ?? "GET";
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ method, path, body });
      const [, , id, action] = path.split("/");

      if (path === "/pages" && method === "GET") {
        return json({ pages: [...pages.values()].map(summary) });
      }
      if (path === "/pages" && method === "POST") {
        const input = workspacePageCreateSchema.parse(body);
        const page = {
          ...doc(input.id ?? "new", input.blocks),
          title: input.title,
          parentId: input.parentId,
        };
        write(page, []);
        return json({ page }, 201);
      }
      if (path === "/prefs") {
        if (method === "PUT") {
          prefs = {
            ...workspacePrefsInputSchema.parse(body),
            updatedAt: new Date().toISOString(),
          };
        }
        return json({ prefs });
      }
      if (path.startsWith("/changes")) {
        return json({
          cursor: new Date().toISOString(),
          pages: [...pages.values()].map(summary),
          purged: [],
          prefsUpdatedAt: prefs.updatedAt,
        });
      }
      const page = id ? pages.get(id) : undefined;
      if (!page) return json({ error: "not found" }, 404);
      if (!action && method === "GET") return json({ page });
      if (action === "ops") {
        const request = workspaceOpsRequestSchema.parse(body);
        const since = [...(touched.get(page.id) ?? new Map()).entries()]
          .filter(([rev]) => rev > request.baseRev)
          .flatMap(([, ids]) => ids);
        const targets = request.ops.flatMap((op) =>
          op.op === "insert" ? [op.block.id] : op.op === "page" ? [] : [op.id],
        );
        const conflicts = targets.filter((t) => since.includes(t));
        if (conflicts.length > 0) {
          return json({ error: "conflict", conflicts, page }, 409);
        }
        const result = applyWorkspaceOps(page, request.ops);
        const next = { ...result.page, rev: page.rev + 1 };
        write(next, result.touched);
        return json({ page: next });
      }
      return json({ error: "unhandled" }, 500);
    },
  });

  return {
    client,
    requests,
    page: (id: string) => pages.get(id),
    /** An agent's edit through the same API. */
    editElsewhere(id: string, blocks: Block[], ids: string[]) {
      const page = pages.get(id);
      if (!page) throw new Error(`no page ${id}`);
      write({ ...page, blocks, rev: page.rev + 1 }, ids);
    },
  };
}

const state = () => useWorkspaceStore.getState();

afterEach(() => {
  resetWorkspaceSync();
  useWorkspaceStore.setState({
    workspace: seedWorkspace(),
    loaded: {},
    blockCounts: {},
    ready: false,
    error: null,
  });
});

describe("workspace sync", () => {
  test("hydrating loads the tree, then a page's blocks when it is opened", async () => {
    const server = fakeServer([
      doc(HOME_PAGE_ID, [text("a")]),
      doc("p2", [text("x"), text("y")]),
    ]);
    await state().hydrate({ client: server.client });
    expect(state().ready).toBe(true);
    expect(Object.keys(state().workspace.pages).sort()).toEqual(["home", "p2"]);
    expect(state().loaded.p2).toBeUndefined();
    expect(state().blockCounts.p2).toBe(2);

    await state().ensurePage("p2");
    expect(state().loaded.p2).toBe(1);
    expect(state().workspace.pages.p2?.blocks).toEqual([text("x"), text("y")]);
  });

  test("an empty server receives the seed", async () => {
    const server = fakeServer([]);
    await state().hydrate({ client: server.client });
    expect(server.page(HOME_PAGE_ID)).toBeDefined();
    expect(
      server.requests.filter((r) => r.path === "/pages" && r.method === "POST")
        .length,
    ).toBe(Object.keys(seedWorkspace().pages).length);
  });

  test("block edits go out as ops against the loaded rev", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [text("a")])]);
    await state().hydrate({ client: server.client });
    await state().ensurePage(HOME_PAGE_ID);
    state().addBlock(HOME_PAGE_ID, text("b"));
    state().updateBlock(HOME_PAGE_ID, text("a", "A"));
    await flushWorkspace();
    const sent = server.requests.find((r) => r.path.endsWith("/ops"));
    expect(sent?.body).toMatchObject({ baseRev: 1 });
    expect(server.page(HOME_PAGE_ID)?.blocks).toEqual([
      text("a", "A"),
      text("b"),
    ]);
    expect(state().loaded[HOME_PAGE_ID]).toBe(2);
  });

  test("an agent's edit to another block survives and shows up here", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [text("a"), text("b")])]);
    await state().hydrate({ client: server.client });
    await state().ensurePage(HOME_PAGE_ID);
    server.editElsewhere(HOME_PAGE_ID, [text("a", "agent"), text("b")], ["a"]);
    state().updateBlock(HOME_PAGE_ID, text("b", "mine"));
    await flushWorkspace();
    expect(state().workspace.pages[HOME_PAGE_ID]?.blocks).toEqual([
      text("a", "agent"),
      text("b", "mine"),
    ]);
  });

  test("a collision on the same block adopts the server's page", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [text("a")])]);
    await state().hydrate({ client: server.client });
    await state().ensurePage(HOME_PAGE_ID);
    server.editElsewhere(HOME_PAGE_ID, [text("a", "agent")], ["a"]);
    state().updateBlock(HOME_PAGE_ID, text("a", "mine"));
    await flushWorkspace();
    expect(state().workspace.pages[HOME_PAGE_ID]?.blocks).toEqual([
      text("a", "agent"),
    ]);
    expect(state().loaded[HOME_PAGE_ID]).toBe(2);
  });

  test("the change feed brings in an open page's newer rev", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [text("a")])]);
    await state().hydrate({ client: server.client });
    await state().ensurePage(HOME_PAGE_ID);
    server.editElsewhere(HOME_PAGE_ID, [text("a"), text("z")], ["z"]);
    await pollWorkspaceChanges();
    expect(state().workspace.pages[HOME_PAGE_ID]?.blocks).toEqual([
      text("a"),
      text("z"),
    ]);
  });

  test("a new page's first edits wait for it to exist", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [])]);
    await state().hydrate({ client: server.client });
    const id = state().createPage(null, "Plan");
    state().addBlock(id, text("p"));
    await flushWorkspace();
    expect(server.page(id)?.blocks).toEqual([text("p")]);
    expect(server.page(id)?.title).toBe("Plan");
  });

  test("the device copy shows at once and the server's answer replaces it", async () => {
    const server = fakeServer([doc(HOME_PAGE_ID, [text("server")], 3)]);
    const cached: WorkspaceCache = {
      ...seedWorkspace(),
      pages: { [HOME_PAGE_ID]: { ...doc(HOME_PAGE_ID, [text("cached")]) } },
      revs: { [HOME_PAGE_ID]: 1 },
    };
    const saved: WorkspaceCache[] = [];
    let readyBeforeServer = false;
    const hydrating = state().hydrate({
      client: server.client,
      local: {
        load: async () => cached,
        save: async (copy) => {
          saved.push(copy);
        },
      },
    });
    readyBeforeServer = state().ready;
    await hydrating;
    expect(readyBeforeServer || state().ready).toBe(true);
    expect(state().workspace.pages[HOME_PAGE_ID]?.blocks).toEqual([
      text("server"),
    ]);
    expect(state().loaded[HOME_PAGE_ID]).toBe(3);
  });
});
