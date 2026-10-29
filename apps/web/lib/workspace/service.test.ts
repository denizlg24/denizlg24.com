import { describe, expect, test } from "bun:test";
import type {
  Block,
  LegacyBlock,
  LegacyPage,
  LegacyWorkspace,
  RichText,
} from "@repo/schemas";
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

const runs = (text: string): RichText => (text ? [{ type: "text", text }] : []);

/** A v1 text block, and the paragraph it becomes. */
const text = (id: string, markdown = id): LegacyBlock => ({
  id,
  span: 6,
  type: "text",
  markdown,
});
const para = (id: string, value = id): Block => ({
  id,
  type: "paragraph",
  text: runs(value),
});
const toggle = (id: string, children: Block[]): Block => ({
  id,
  type: "toggle",
  text: runs(id),
  children,
});

function v1Page(
  id: string,
  blocks: LegacyBlock[],
  extra: Partial<LegacyPage> = {},
): LegacyPage {
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

function legacyDoc(): LegacyWorkspace {
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

/** Migrated, and both pages read once, so each sits at rev 2 as a flow. */
async function setup(legacy: unknown = legacyDoc()) {
  const memory = memoryWorkspaceRepo(legacy);
  const service = createWorkspaceService(memory.repo, { now, newId });
  await service.ensureMigrated();
  for (const page of await service.listPages()) await service.getPage(page.id);
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
    const memory = memoryWorkspaceRepo(legacy);
    const service = createWorkspaceService(memory.repo, { now, newId });
    await service.ensureMigrated();
    const pages = await service.listPages();
    expect(pages.map((p) => [p.id, p.rev, p.blockCount]).sort()).toEqual([
      ["home", 1, 2],
      ["notes", 1, 1],
    ]);
    expect(memory.prefs()?.favorites).toEqual(legacy.favorites);
    expect(memory.prefs()?.sidebar.width).toBe(260);
    expect(memory.prefs()?.migratedFrom).toBe(legacy.savedAt ?? null);
    expect(memory.revisions.filter((r) => r.kind === "migrate")).toHaveLength(
      2,
    );
    expect(legacy).toEqual(snapshot);
  });

  test("a page becomes a flow on first read, as one revision by `migration`", async () => {
    const memory = memoryWorkspaceRepo({
      ...legacyDoc(),
      pages: {
        home: v1Page("home", [
          { id: "g", span: 6, type: "greeting" },
          { id: "ag", span: 4, type: "agenda" },
          { ...text("t", "## Plan\n\n- one"), span: 2 },
        ]),
      },
    });
    const service = createWorkspaceService(memory.repo, { now, newId });
    await service.ensureMigrated();
    const page = await service.getPage("home");
    expect(page.rev).toBe(2);
    expect(page.blocks.map((b) => b.type)).toEqual(["greeting", "columns"]);
    const row = page.blocks[1];
    expect(
      row?.type === "columns" &&
        row.children.map((c) => [c.width, c.children.map((b) => b.type)]),
    ).toEqual([
      [4 / 6, ["agenda"]],
      [2 / 6, ["heading", "bullet"]],
    ]);
    expect(memory.revisions.at(-1)).toMatchObject({
      rev: 2,
      actor: "migration",
      kind: "migrate",
    });
    // A second read, and a fresh process, change nothing.
    await service.getPage("home");
    const again = createWorkspaceService(memory.repo, { now, newId });
    expect((await again.getPage("home")).rev).toBe(2);
    expect(memory.revisions).toHaveLength(2);

    // Restoring to rev 1 converts the grid afresh: the same flow.
    const restored = await service.revertToRev("home", 1, OWNER);
    expect(restored.rev).toBe(2);
    expect((await service.history("home", { limit: 5 }))[0]?.actor).toBe(
      "migration",
    );
  });

  test("an op written against the grid's rev is a conflict once the page is a flow", async () => {
    const memory = memoryWorkspaceRepo(legacyDoc());
    const service = createWorkspaceService(memory.repo, { now, newId });
    await service.ensureMigrated();
    const error = await rejection(
      service.applyOps(
        "home",
        { baseRev: 1, ops: [{ op: "delete", id: "a" }] },
        OWNER,
      ),
    );
    expect(error.status).toBe(409);
    expect(error.details.page).toMatchObject({ rev: 2 });
  });

  test("is idempotent: a second run, a racing service and a resumed run change nothing", async () => {
    const memory = memoryWorkspaceRepo(legacyDoc());
    const first = createWorkspaceService(memory.repo, { now, newId });
    const second = createWorkspaceService(memory.repo, { now, newId });
    await Promise.all([first.ensureMigrated(), second.ensureMigrated()]);
    await Promise.all([first.getPage("home"), second.getPage("home")]);
    await first.applyOps(
      "home",
      { baseRev: 2, ops: [{ op: "delete", id: "a" }] },
      OWNER,
    );
    const third = createWorkspaceService(memory.repo, { now, newId });
    await third.ensureMigrated();
    expect(memory.pages.size).toBe(2);
    expect(memory.pages.get("home")?.rev).toBe(3);
    expect(memory.revisions).toHaveLength(4);

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
      {
        baseRev: 2,
        ops: [{ op: "update", id: "a", set: { text: runs("A") } }],
      },
      AGENT,
    );
    const page = await service.applyOps(
      "home",
      { baseRev: 2, ops: [{ op: "insert", block: para("c"), after: "b" }] },
      OWNER,
    );
    expect(page.rev).toBe(4);
    expect(page.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(page.blocks[0]).toEqual(para("a", "A"));
  });

  test("an op on a block changed since baseRev is a 409 with the current page", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [{ op: "update", id: "a", set: { text: runs("A") } }],
      },
      AGENT,
    );
    const error = await rejection(
      service.applyOps(
        "home",
        { baseRev: 2, ops: [{ op: "delete", id: "a" }] },
        OWNER,
      ),
    );
    expect(error.status).toBe(409);
    expect(error.details.conflicts).toEqual(["a"]);
    expect(error.details.page).toMatchObject({ rev: 3 });
  });

  test("an insert after a block deleted since is a conflict, on the current rev a 400", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 2, ops: [{ op: "delete", id: "b" }] },
      AGENT,
    );
    const stale = await rejection(
      service.applyOps(
        "home",
        { baseRev: 2, ops: [{ op: "insert", block: para("c"), after: "b" }] },
        OWNER,
      ),
    );
    expect(stale.status).toBe(409);
    const current = await rejection(
      service.applyOps(
        "home",
        { baseRev: 3, ops: [{ op: "insert", block: para("c"), after: "b" }] },
        OWNER,
      ),
    );
    expect(current.status).toBe(400);
    expect(current.code).toBe("MISSING_ANCHOR");
  });

  test("blocks nest: insert into a parent, move out, delete takes the subtree", async () => {
    const { service } = await setup();
    let page = await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [
          { op: "insert", block: toggle("t", [para("t1")]), after: "b" },
          { op: "insert", block: para("t2"), parentId: "t", after: "t1" },
          { op: "move", id: "a", parentId: "t", after: null },
        ],
      },
      OWNER,
    );
    expect(page.blocks).toEqual([
      para("b"),
      toggle("t", [para("a"), para("t1"), para("t2")]),
    ]);
    page = await service.applyOps(
      "home",
      {
        baseRev: page.rev,
        ops: [
          { op: "move", id: "t2", after: null },
          { op: "delete", id: "t" },
        ],
      },
      OWNER,
    );
    expect(page.blocks).toEqual([para("t2"), para("b")]);
    const history = await service.history("home", { limit: 1 });
    expect(history[0]?.touched.sort()).toEqual(["a", "t", "t1", "t2"]);
  });

  test("a block whose ancestor moved or was deleted since baseRev conflicts", async () => {
    const { service } = await setup();
    const nested = await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [
          { op: "insert", block: toggle("t", [para("inner")]) },
          { op: "insert", block: toggle("u", []) },
        ],
      },
      OWNER,
    );
    // Someone moves the toggle; an edit inside it written before that conflicts.
    await service.applyOps(
      "home",
      { baseRev: nested.rev, ops: [{ op: "move", id: "t", after: null }] },
      AGENT,
    );
    const inside = await rejection(
      service.applyOps(
        "home",
        {
          baseRev: nested.rev,
          ops: [{ op: "update", id: "inner", set: { text: runs("x") } }],
        },
        OWNER,
      ),
    );
    expect(inside.status).toBe(409);
    expect(inside.details.conflicts).toEqual(["inner"]);
    // Moving something into the moved toggle conflicts too; into another does not.
    const into = await rejection(
      service.applyOps(
        "home",
        { baseRev: nested.rev, ops: [{ op: "move", id: "a", parentId: "t" }] },
        OWNER,
      ),
    );
    expect(into.status).toBe(409);
    const elsewhere = await service.applyOps(
      "home",
      { baseRev: nested.rev, ops: [{ op: "move", id: "a", parentId: "u" }] },
      OWNER,
    );
    expect(elsewhere.blocks.find((b) => b.id === "u")).toEqual(
      toggle("u", [para("a")]),
    );
  });

  test("locked pages refuse agents and admit the owner", async () => {
    const { service } = await setup();
    await service.updateMeta("home", { locked: true }, OWNER);
    for (const attempt of [
      service.applyOps(
        "home",
        { baseRev: 3, ops: [{ op: "delete", id: "a" }] },
        AGENT,
      ),
      service.updateMeta("home", { locked: false }, AGENT),
      service.fromMarkdown("home", 3, "# x", AGENT),
      service.revertToRev("home", 1, AGENT),
    ]) {
      expect((await rejection(attempt)).status).toBe(423);
    }
    const page = await service.applyOps(
      "home",
      {
        baseRev: 3,
        ops: [{ op: "update", id: "a", set: { text: runs("ok") } }],
      },
      OWNER,
    );
    expect(page.rev).toBe(4);
  });

  test("every revision records its actor and credential", async () => {
    const { service, revisions } = await setup();
    await service.applyOps(
      "home",
      { baseRev: 2, ops: [{ op: "delete", id: "a" }] },
      AGENT,
    );
    const last = revisions.at(-1);
    expect(last).toMatchObject({
      actor: "conversation:c1",
      via: "mcp:svc",
      kind: "ops",
    });
    expect((await service.history("home", { limit: 1 }))[0]).toMatchObject({
      rev: 3,
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
            { op: "update", id: "a", set: { text: runs(`v${page.rev + 1}`) } },
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
    expect(reverted.blocks[0]).toEqual(para("a", `v${target}`));
    const original = await service.revertToRev("home", 2, OWNER);
    expect(original.blocks).toEqual([para("a"), para("b")]);
  });

  test("reverting an actor skips blocks someone else touched later", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [
          { op: "update", id: "a", set: { text: runs("agent a") } },
          { op: "update", id: "b", set: { text: runs("agent b") } },
          { op: "insert", block: para("x"), after: "b" },
        ],
      },
      AGENT,
    );
    await service.applyOps(
      "home",
      {
        baseRev: 3,
        ops: [{ op: "update", id: "b", set: { text: runs("owner b") } }],
      },
      OWNER,
    );
    const result = await service.revertActor("home", AGENT.actor, 0, OWNER);
    expect(result.skipped).toBe(1);
    expect(result.page.blocks).toEqual([para("a"), para("b", "owner b")]);
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
      `${markdown.replace("\nb <!--", "\nB <!--")}\n\n## Added\n\n- nested\n  - child`,
      AGENT,
    );
    expect(edited.blocks.map((b) => b.id.startsWith("id"))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(edited.blocks[1]).toEqual(para("b", "B"));
    const list = edited.blocks[3];
    expect(list?.type === "bullet" && list.children[0]?.type).toBe("bullet");
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
      { baseRev: 2, ops: [{ op: "delete", id: "a" }] },
      AGENT,
    );
    await service.archivePage("notes", OWNER);
    await service.purgePage("notes", OWNER);
    const next = await service.changes(cursor);
    expect(next.pages.map((p) => [p.id, p.rev])).toEqual([["home", 3]]);
    expect(next.purged).toEqual(["notes"]);
  });
});

describe("desktop 3.0.0 compatibility", () => {
  test("GET serves every flow as a valid v1 grid, stamped with the server's now", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [
          {
            op: "insert",
            block: {
              id: "row",
              type: "columns",
              children: [
                {
                  id: "c1",
                  type: "column",
                  width: 0.5,
                  children: [{ id: "ag", type: "agenda" }],
                },
                {
                  id: "c2",
                  type: "column",
                  width: 0.5,
                  children: [toggle("t", [para("in")])],
                },
              ],
            },
          },
        ],
      },
      OWNER,
    );
    const doc = await service.compatGet();
    expect(Object.keys(doc.pages).sort()).toEqual(["home", "notes"]);
    expect(doc.favorites).toEqual(["page:notes", "module:inbox"]);
    expect(Date.parse(doc.savedAt ?? "")).toBeGreaterThan(
      Date.parse("2026-10-29"),
    );
    const home = doc.pages.home;
    expect(home?.blocks.map((b) => [b.id, b.type, b.span])).toEqual([
      ["a", "text", 6],
      ["b", "text", 6],
      ["ag", "agenda", 3],
      ["t", "text", 3],
    ]);
    const toggleText = home?.blocks[3];
    expect(toggleText?.type === "text" && toggleText.markdown).toContain(
      "<details>",
    );
  });

  test("a stale whole-document PUT never undoes an agent's edit", async () => {
    const { service } = await setup();
    const held = await service.compatGet();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [{ op: "update", id: "a", set: { text: runs("agent") } }],
      },
      AGENT,
    );
    await service.updateMeta("notes", { title: "Agent title" }, AGENT);

    // 3.0.0 never saw those; it edits b, adds d and adds a page.
    const home = held.pages.home;
    if (!home) throw new Error("home missing");
    const [heldA, heldB] = home.blocks;
    if (heldB?.type !== "text" || !heldA) throw new Error("unexpected grid");
    const edited: LegacyPage = {
      ...home,
      blocks: [
        heldA,
        { ...heldB, markdown: heldB.markdown.replace(/^b /, "desktop ") },
        text("d"),
      ],
    };
    await service.compatPut({
      ...held,
      pages: {
        ...held.pages,
        home: edited,
        fresh: v1Page("fresh", [text("f")]),
      },
    });
    const merged = await service.getPage("home");
    expect(merged.blocks).toEqual([
      para("a", "agent"),
      para("b", "desktop"),
      para("d"),
    ]);
    expect((await service.getPage("notes")).title).toBe("Agent title");
    expect((await service.getPage("fresh")).blocks).toEqual([para("f")]);

    // The same stale document again changes nothing.
    await service.compatPut({
      ...held,
      pages: {
        ...held.pages,
        home: edited,
        fresh: v1Page("fresh", [text("f")]),
      },
    });
    expect((await service.getPage("home")).rev).toBe(merged.rev);
  });

  test("a PUT never restructures a flow: spans and order are ignored, edits inside columns apply", async () => {
    const { service } = await setup();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [
          {
            op: "insert",
            block: {
              id: "row",
              type: "columns",
              children: [
                {
                  id: "c1",
                  type: "column",
                  width: 0.5,
                  children: [para("left")],
                },
                {
                  id: "c2",
                  type: "column",
                  width: 0.5,
                  children: [para("right")],
                },
              ],
            },
          },
        ],
      },
      OWNER,
    );
    const before = await service.getPage("home");
    const held = await service.compatGet();
    const home = held.pages.home;
    if (!home) throw new Error("home missing");
    const reordered = [...home.blocks]
      .reverse()
      .map((b) => ({ ...b, span: 6 as const }));
    await service.compatPut({
      ...held,
      pages: { ...held.pages, home: { ...home, blocks: reordered } },
    });
    expect((await service.getPage("home")).rev).toBe(before.rev);

    const held2 = await service.compatGet();
    const home2 = held2.pages.home;
    if (!home2) throw new Error("home missing");
    await service.compatPut({
      ...held2,
      pages: {
        ...held2.pages,
        home: {
          ...home2,
          blocks: home2.blocks.map((b) =>
            b.id === "left" && b.type === "text"
              ? { ...b, markdown: b.markdown.replace(/^left /, "edited ") }
              : b,
          ),
        },
      },
    });
    const after = await service.getPage("home");
    const row = after.blocks.find((b) => b.id === "row");
    expect(row?.type === "columns" && row.children[0]?.children).toEqual([
      para("left", "edited"),
    ]);
  });

  test("a collision on the same block keeps the stored copy", async () => {
    const { service } = await setup();
    const held = await service.compatGet();
    await service.applyOps(
      "home",
      {
        baseRev: 2,
        ops: [{ op: "update", id: "a", set: { text: runs("agent") } }],
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
      para("a", "agent"),
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
