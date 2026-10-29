import { describe, expect, test } from "bun:test";
import type { Block, Workspace, WorkspacePage } from "@repo/schemas";
import { memoryWorkspaceRepo } from "./memory-repo.test-util";
import {
  createWorkspaceService,
  OWNER,
  SNAPSHOT_EVERY,
  type WorkspaceCaller,
  WorkspaceError,
} from "./service";

const AGENT: WorkspaceCaller = {
  actor: "conversation:c1",
  via: "mcp:svc",
  agent: true,
};

const text = (id: string, markdown = id): Block => ({
  id,
  span: 6,
  type: "text",
  markdown,
});

function v1Page(
  id: string,
  blocks: Block[],
  extra: Partial<WorkspacePage> = {},
): WorkspacePage {
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
    ...extra,
  };
}

function legacyDoc(): Workspace {
  return {
    version: 1,
    savedAt: "2026-10-20T10:00:00.000Z",
    pages: {
      home: v1Page("home", [text("a"), text("b")]),
      notes: v1Page("notes", [text("n1")], { parentId: "home", order: 1 }),
    },
    favorites: ["page:notes", "module:inbox"],
    recents: ["page:home"],
    sidebar: {
      width: 260,
      collapsed: false,
      hiddenModules: [],
      collapsedSections: ["money"],
      expandedPages: ["home"],
    },
  };
}

let tick = Date.parse("2026-10-29T12:00:00.000Z");
const now = () => {
  tick += 1000;
  return new Date(tick);
};
let ids = 0;
const newId = () => `id${++ids}`;

async function setup(legacy: unknown = legacyDoc()) {
  const memory = memoryWorkspaceRepo(legacy);
  const service = createWorkspaceService(memory.repo, { now, newId });
  await service.ensureMigrated();
  return { ...memory, service };
}

async function rejection(promise: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceError) return error;
    throw error;
  }
  throw new Error("expected a WorkspaceError");
}

describe("migration", () => {
  test("splits the v1 document into pages and prefs and leaves it untouched", async () => {
    const legacy = legacyDoc();
    const snapshot = structuredClone(legacy);
    const { service, revisions, prefs } = await setup(legacy);
    const pages = await service.listPages();
    expect(pages.map((p) => [p.id, p.rev, p.blockCount]).sort()).toEqual([
      ["home", 1, 2],
      ["notes", 1, 1],
    ]);
    expect((await service.getPage("home")).blocks).toEqual(
      legacy.pages.home?.blocks ?? [],
    );
    expect(prefs()?.favorites).toEqual(legacy.favorites);
    expect(prefs()?.sidebar.width).toBe(260);
    expect(prefs()?.migratedFrom).toBe(legacy.savedAt ?? null);
    expect(revisions.filter((r) => r.kind === "migrate")).toHaveLength(2);
    expect(legacy).toEqual(snapshot);
  });

  test("is idempotent: a second run, a racing service and a resumed run change nothing", async () => {
    const memory = memoryWorkspaceRepo(legacyDoc());
    const first = createWorkspaceService(memory.repo, { now, newId });
    const second = createWorkspaceService(memory.repo, { now, newId });
    await Promise.all([first.ensureMigrated(), second.ensureMigrated()]);
    await first.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "delete", id: "a" }] },
      OWNER,
    );
    const third = createWorkspaceService(memory.repo, { now, newId });
    await third.ensureMigrated();
    expect(memory.pages.size).toBe(2);
    expect(memory.pages.get("home")?.rev).toBe(2);
    expect(memory.revisions).toHaveLength(3);

    // A run that died after writing pages but before prefs resumes cleanly.
    const partial = memoryWorkspaceRepo(legacyDoc());
    const dying = createWorkspaceService(
      {
        ...partial.repo,
        insertPrefs: async () => {
          throw new Error("crash");
        },
      },
      { now, newId },
    );
    await expect(dying.ensureMigrated()).rejects.toThrow("crash");
    const resumed = createWorkspaceService(partial.repo, { now, newId });
    await resumed.ensureMigrated();
    expect(partial.pages.size).toBe(2);
    expect(partial.revisions).toHaveLength(2);
    expect(partial.prefs()).not.toBeNull();
  });

  test("no v1 document migrates to empty prefs; an unreadable page is skipped", async () => {
    const empty = await setup(null);
    expect(await empty.service.listPages()).toEqual([]);
    expect(empty.prefs()?.favorites).toEqual([]);

    const broken = legacyDoc();
    const bad = await setup({
      ...broken,
      pages: { ...broken.pages, bad: { id: 1 } },
    });
    expect((await bad.service.listPages()).map((p) => p.id).sort()).toEqual([
      "home",
      "notes",
    ]);
  });
});

describe("ops", () => {
  test("ops on other blocks rebase onto a newer rev", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "update", id: "a", set: { markdown: "A" } }] },
      AGENT,
    );
    const page = await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "insert", block: text("c"), after: "b" }] },
      OWNER,
    );
    expect(page.rev).toBe(3);
    expect(page.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(page.blocks[0]).toEqual(text("a", "A"));
  });

  test("an op on a block changed since baseRev is a 409 with the current page", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "update", id: "a", set: { markdown: "A" } }] },
      AGENT,
    );
    const error = await rejection(
      service.applyOps(
        "home",
        { baseRev: 1, ops: [{ op: "delete", id: "a" }] },
        OWNER,
      ),
    );
    expect(error.status).toBe(409);
    expect(error.details.conflicts).toEqual(["a"]);
    expect(error.details.page).toMatchObject({ rev: 2 });
  });

  test("an insert after a block deleted since is a conflict, on the current rev a 400", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "delete", id: "b" }] },
      AGENT,
    );
    const stale = await rejection(
      service.applyOps(
        "home",
        { baseRev: 1, ops: [{ op: "insert", block: text("c"), after: "b" }] },
        OWNER,
      ),
    );
    expect(stale.status).toBe(409);
    const current = await rejection(
      service.applyOps(
        "home",
        { baseRev: 2, ops: [{ op: "insert", block: text("c"), after: "b" }] },
        OWNER,
      ),
    );
    expect(current.status).toBe(400);
    expect(current.code).toBe("MISSING_ANCHOR");
  });

  test("locked pages refuse agents and admit the owner", async () => {
    const { service } = await setup();
    await service.updateMeta("home", { locked: true }, OWNER);
    for (const attempt of [
      service.applyOps(
        "home",
        { baseRev: 2, ops: [{ op: "delete", id: "a" }] },
        AGENT,
      ),
      service.updateMeta("home", { locked: false }, AGENT),
      service.fromMarkdown("home", 2, "# x", AGENT),
      service.revertToRev("home", 1, AGENT),
    ]) {
      expect((await rejection(attempt)).status).toBe(423);
    }
    const page = await service.applyOps(
      "home",
      { baseRev: 2, ops: [{ op: "update", id: "a", set: { markdown: "ok" } }] },
      OWNER,
    );
    expect(page.rev).toBe(3);
  });

  test("every revision records its actor and credential", async () => {
    const { service, revisions } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "delete", id: "a" }] },
      AGENT,
    );
    const last = revisions.at(-1);
    expect(last).toMatchObject({
      actor: "conversation:c1",
      via: "mcp:svc",
      kind: "ops",
    });
    expect((await service.history("home", { limit: 1 }))[0]).toMatchObject({
      rev: 2,
      actor: "conversation:c1",
      touched: ["a"],
    });
  });
});

describe("history", () => {
  test("revert to a rev rebuilds the page from the nearest snapshot", async () => {
    const { service, revisions } = await setup();
    for (let i = 0; i < SNAPSHOT_EVERY + 3; i++) {
      const page = await service.getPage("home");
      await service.applyOps(
        "home",
        {
          baseRev: page.rev,
          ops: [
            { op: "update", id: "a", set: { markdown: `v${page.rev + 1}` } },
          ],
        },
        OWNER,
      );
    }
    expect(revisions.some((r) => r.rev === SNAPSHOT_EVERY && r.snapshot)).toBe(
      true,
    );
    const target = SNAPSHOT_EVERY + 1;
    const reverted = await service.revertToRev("home", target, OWNER);
    expect(reverted.blocks[0]).toEqual(text("a", `v${target}`));
    const original = await service.revertToRev("home", 1, OWNER);
    expect(original.blocks).toEqual([text("a"), text("b")]);
  });

  test("reverting an actor skips blocks someone else touched later", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      {
        baseRev: 1,
        ops: [
          { op: "update", id: "a", set: { markdown: "agent a" } },
          { op: "update", id: "b", set: { markdown: "agent b" } },
          { op: "insert", block: text("x"), after: "b" },
        ],
      },
      AGENT,
    );
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [{ op: "update", id: "b", set: { markdown: "owner b" } }],
      },
      OWNER,
    );
    const result = await service.revertActor("home", AGENT.actor, 0, OWNER);
    expect(result.skipped).toBe(1);
    expect(result.page.blocks).toEqual([text("a"), text("b", "owner b")]);
  });
});

describe("markdown", () => {
  test("to_markdown then from_markdown is a no-op; an edit keeps ids", async () => {
    const { service } = await setup();
    const { markdown, rev } = await service.toMarkdown("home");
    const same = await service.fromMarkdown("home", rev, markdown, AGENT);
    expect(same.rev).toBe(rev);
    const edited = await service.fromMarkdown(
      "home",
      rev,
      `${markdown.replace("\nb", "\nB")}\n\n## Added`,
      AGENT,
    );
    expect(edited.blocks.map((b) => b.id)).toEqual(["a", "b", "id1"]);
    expect(edited.blocks[1]).toEqual(text("b", "B"));
    expect(
      (await rejection(service.fromMarkdown("home", rev, "x", AGENT))).status,
    ).toBe(409);
  });
});

describe("pages", () => {
  test("create, move, archive, restore and purge keep the tree consistent", async () => {
    const { service } = await setup();
    const child = await service.createPage(
      { title: "Plan", parentId: "notes", markdown: "## Week\n\n- [ ] ship" },
      AGENT,
    );
    expect(child.blocks.map((b) => b.type)).toEqual(["heading", "todo"]);
    const moved = await service.movePage(
      child.id,
      { parentId: "home", index: 0 },
      OWNER,
    );
    expect(moved.parentId).toBe("home");
    expect(moved.order).toBeLessThan(1);
    expect(
      (await rejection(service.movePage("home", { parentId: child.id }, OWNER)))
        .status,
    ).toBe(400);

    const archived = await service.archivePage("notes", OWNER);
    expect(archived.map((p) => p.id)).toEqual(["notes"]);
    expect((await rejection(service.purgePage(child.id, OWNER))).code).toBe(
      "NOT_ARCHIVED",
    );
    await service.archivePage(child.id, OWNER);
    const purged = await service.purgePage(child.id, OWNER);
    expect(purged).toEqual([child.id]);
    expect((await rejection(service.getPage(child.id))).status).toBe(404);

    const restored = await service.restorePage("notes", OWNER);
    expect(restored[0]?.deletedAt).toBeNull();
  });

  test("the change feed reports pages and purges since a cursor", async () => {
    const { service } = await setup();
    const first = await service.changes(null);
    expect(first.pages.length).toBe(2);
    tick += 60_000;
    const cursor = new Date(tick).toISOString();
    await service.applyOps(
      "home",
      { baseRev: 1, ops: [{ op: "delete", id: "a" }] },
      AGENT,
    );
    await service.archivePage("notes", OWNER);
    await service.purgePage("notes", OWNER);
    const next = await service.changes(cursor);
    expect(next.pages.map((p) => [p.id, p.rev])).toEqual([["home", 2]]);
    expect(next.purged).toEqual(["notes"]);
  });
});

describe("desktop 3.0.0 compatibility", () => {
  test("GET assembles the v1 document stamped with the server's now", async () => {
    const { service } = await setup();
    const doc = await service.compatGet();
    expect(Object.keys(doc.pages).sort()).toEqual(["home", "notes"]);
    expect(doc.favorites).toEqual(["page:notes", "module:inbox"]);
    expect(Date.parse(doc.savedAt ?? "")).toBeGreaterThan(
      Date.parse("2026-10-29"),
    );
  });

  test("a stale whole-document PUT never undoes an agent's edit", async () => {
    const { service } = await setup();
    const held = await service.compatGet();
    await service.applyOps(
      "home",
      {
        baseRev: 1,
        ops: [{ op: "update", id: "a", set: { markdown: "agent" } }],
      },
      AGENT,
    );
    await service.updateMeta("notes", { title: "Agent title" }, AGENT);

    // 3.0.0 never saw those; it edits b and adds a page.
    const home = held.pages.home;
    if (!home) throw new Error("home missing");
    await service.compatPut({
      ...held,
      pages: {
        ...held.pages,
        home: { ...home, blocks: [text("a"), text("b", "desktop"), text("d")] },
        fresh: v1Page("fresh", [text("f")]),
      },
    });
    const merged = await service.getPage("home");
    expect(merged.blocks).toEqual([
      text("a", "agent"),
      text("b", "desktop"),
      text("d"),
    ]);
    expect((await service.getPage("notes")).title).toBe("Agent title");
    expect((await service.getPage("fresh")).blocks).toEqual([text("f")]);

    // The same stale document again changes nothing.
    const again = await service.compatPut({
      ...held,
      pages: {
        ...held.pages,
        home: { ...home, blocks: [text("a"), text("b", "desktop"), text("d")] },
        fresh: v1Page("fresh", [text("f")]),
      },
    });
    expect(again).toBeUndefined();
    expect((await service.getPage("home")).rev).toBe(merged.rev);
  });

  test("a collision on the same block keeps the stored copy", async () => {
    const { service } = await setup();
    const held = await service.compatGet();
    await service.applyOps(
      "home",
      {
        baseRev: 1,
        ops: [{ op: "update", id: "a", set: { markdown: "agent" } }],
      },
      AGENT,
    );
    const home = held.pages.home;
    if (!home) throw new Error("home missing");
    await service.compatPut({
      ...held,
      pages: { ...held.pages, home: { ...home, blocks: [] } },
    });
    expect((await service.getPage("home")).blocks).toEqual([
      text("a", "agent"),
    ]);
  });

  test("a dropped page is purged only when trashed and unchanged", async () => {
    const { service } = await setup();
    await service.archivePage("notes", OWNER);
    const held = await service.compatGet();
    const { notes: _dropped, ...rest } = held.pages;
    await service.compatPut({ ...held, pages: rest });
    expect((await rejection(service.getPage("notes"))).status).toBe(404);

    const other = await setup();
    await other.service.archivePage("notes", OWNER);
    const held2 = await other.service.compatGet();
    await other.service.restorePage("notes", AGENT);
    const { notes: _gone, ...rest2 } = held2.pages;
    await other.service.compatPut({ ...held2, pages: rest2 });
    expect((await other.service.getPage("notes")).deletedAt).toBeNull();
  });

  test("prefs merge field by field against what 3.0.0 held", async () => {
    const { service, prefs } = await setup();
    const held = await service.compatGet();
    await service.putPrefs({
      favorites: ["page:home"],
      recents: held.recents,
      sidebar: held.sidebar,
    });
    await service.compatPut({
      ...held,
      favorites: ["module:kanban"],
      sidebar: { ...held.sidebar, width: 300 },
    });
    expect(prefs()?.favorites).toEqual(["page:home"]);
    expect(prefs()?.sidebar.width).toBe(300);
  });
});
