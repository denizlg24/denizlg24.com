import { beforeEach, describe, expect, test } from "bun:test";
import { HOME_PAGE_ID, pageRef } from "@/lib/workspace/schema";
import { seedWorkspace } from "@/lib/workspace/seed";
import { childPages, pageAncestors, useWorkspaceStore } from "./workspace";

const store = () => useWorkspaceStore.getState();
const pages = () => store().workspace.pages;

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: seedWorkspace(), ready: true });
});

describe("workspace pages", () => {
  test("the seed holds Home with every summary and three sub-pages", () => {
    const home = pages()[HOME_PAGE_ID];
    expect(home?.blocks.map((b) => b.type)).toContain("agent");
    expect(home?.blocks.map((b) => b.type)).toContain("modules");
    expect(childPages(pages(), HOME_PAGE_ID).map((p) => p.title)).toEqual([
      "School",
      "Money",
      "Systems",
    ]);
  });

  test("a new child page lands last and expands its parent", () => {
    const id = store().createPage(HOME_PAGE_ID, "Reading list");
    const siblings = childPages(pages(), HOME_PAGE_ID);
    expect(siblings.at(-1)?.id).toBe(id);
    expect(store().workspace.sidebar.expandedPages).toContain(HOME_PAGE_ID);
  });

  test("moving reorders siblings and re-parents", () => {
    const [school, money] = childPages(pages(), HOME_PAGE_ID);
    if (!school || !money) throw new Error("seed changed");
    store().movePage(money.id, HOME_PAGE_ID, 0);
    expect(childPages(pages(), HOME_PAGE_ID)[0]?.id).toBe(money.id);

    store().movePage(school.id, money.id, 0);
    expect(pages()[school.id]?.parentId).toBe(money.id);
    expect(pageAncestors(pages(), school.id).map((p) => p.id)).toEqual([
      HOME_PAGE_ID,
      money.id,
    ]);
  });

  test("a page cannot move inside its own subtree", () => {
    const [school] = childPages(pages(), HOME_PAGE_ID);
    if (!school) throw new Error("seed changed");
    const inner = store().createPage(school.id, "Inner");
    store().movePage(school.id, inner, 0);
    expect(pages()[school.id]?.parentId).toBe(HOME_PAGE_ID);
  });

  test("Home can be neither trashed nor nested", () => {
    const [school] = childPages(pages(), HOME_PAGE_ID);
    if (!school) throw new Error("seed changed");
    store().trashPage(HOME_PAGE_ID);
    store().movePage(HOME_PAGE_ID, school.id, 0);
    expect(pages()[HOME_PAGE_ID]?.deletedAt).toBeNull();
    expect(pages()[HOME_PAGE_ID]?.parentId).toBeNull();
  });

  test("trash takes the subtree and its favorites; restore brings both pages back", () => {
    const [school] = childPages(pages(), HOME_PAGE_ID);
    if (!school) throw new Error("seed changed");
    const inner = store().createPage(school.id, "Inner");
    store().toggleFavorite(pageRef(inner));

    store().trashPage(school.id);
    expect(pages()[inner]?.deletedAt).not.toBeNull();
    expect(store().workspace.favorites).not.toContain(pageRef(inner));
    expect(childPages(pages(), HOME_PAGE_ID).map((p) => p.id)).not.toContain(
      school.id,
    );

    store().restorePage(school.id);
    expect(pages()[school.id]?.deletedAt).toBeNull();
    expect(pages()[inner]?.deletedAt).toBeNull();
  });

  test("restoring a child whose parent is still trashed moves it to the top level", () => {
    const [school] = childPages(pages(), HOME_PAGE_ID);
    if (!school) throw new Error("seed changed");
    const inner = store().createPage(school.id, "Inner");
    store().trashPage(school.id);
    store().restorePage(inner);
    expect(pages()[inner]?.parentId).toBeNull();
    expect(pages()[inner]?.deletedAt).toBeNull();
  });

  test("duplicating copies blocks under new ids, right after the original", () => {
    const [school] = childPages(pages(), HOME_PAGE_ID);
    if (!school) throw new Error("seed changed");
    const copyId = store().duplicatePage(school.id);
    if (!copyId) throw new Error("no copy");
    const copy = pages()[copyId];
    expect(copy?.title).toBe("School (copy)");
    expect(copy?.blocks.length).toBe(school.blocks.length);
    const originalIds = new Set(school.blocks.map((b) => b.id));
    expect(copy?.blocks.some((b) => originalIds.has(b.id))).toBe(false);
    expect(childPages(pages(), HOME_PAGE_ID)[1]?.id).toBe(copyId);
  });
});

describe("workspace blocks and sidebar", () => {
  test("blocks reorder, resize and delete", () => {
    const id = store().createPage(null, "Board");
    store().addBlock(id, { id: "a", type: "divider", span: 6 });
    store().addBlock(id, { id: "b", type: "stats", span: 6 });
    store().moveBlock(id, 1, 0);
    store().setBlockSpan(id, "a", 3);
    expect(pages()[id]?.blocks.map((b) => [b.id, b.span])).toEqual([
      ["b", 6],
      ["a", 3],
    ]);
    store().removeBlock(id, "b");
    expect(pages()[id]?.blocks.map((b) => b.id)).toEqual(["a"]);
  });

  test("the sidebar width is clamped", () => {
    store().setSidebar({ width: 10_000 });
    expect(store().workspace.sidebar.width).toBe(420);
    store().setSidebar({ width: 1 });
    expect(store().workspace.sidebar.width).toBe(200);
  });

  test("recents keep the newest first without duplicates", () => {
    store().recordVisit("module:inbox");
    store().recordVisit("module:notes");
    store().recordVisit("module:inbox");
    expect(store().workspace.recents.slice(0, 2)).toEqual([
      "module:inbox",
      "module:notes",
    ]);
  });
});
