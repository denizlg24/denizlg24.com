import { describe, expect, test } from "bun:test";
import { blockSchema, workspacePageSummarySchema } from "@repo/schemas";
import { findPages, livePages, pagePath } from "./pages";
import { collectRecordRefs } from "./record-refs";

function page(id: string, title: string, extra: Record<string, unknown> = {}) {
  return workspacePageSummarySchema.parse({
    id,
    title,
    icon: null,
    parentId: null,
    order: 0,
    fullWidth: false,
    locked: false,
    createdAt: "2026-11-14T10:00:00Z",
    updatedAt: "2026-11-14T10:00:00Z",
    deletedAt: null,
    rev: 1,
    blockCount: 0,
    ...extra,
  });
}

describe("workspace navigation", () => {
  test("embedded record reads include nested columns and deduplicate repeated records", () => {
    const blocks = blockSchema.array().parse([
      { id: "one", type: "record", ref: "entity:note:note-1" },
      {
        id: "cols",
        type: "columns",
        children: [
          {
            id: "col",
            type: "column",
            width: 1,
            children: [
              { id: "two", type: "record", ref: "entity:course:course-1" },
              { id: "three", type: "record", ref: "entity:note:note-1" },
              { id: "empty", type: "record", ref: "" },
            ],
          },
        ],
      },
      { id: "links", type: "links", refs: ["page:home"] },
    ]);
    expect(collectRecordRefs(blocks)).toEqual([
      "entity:course:course-1",
      "entity:note:note-1",
    ]);
    expect(collectRecordRefs([...blocks].reverse())).toEqual(
      collectRecordRefs(blocks),
    );
  });
  test("root and child navigation use desktop sibling order", () => {
    const pages = [
      page("later", "Later", { order: 5 }),
      page("first", "First", { order: 1 }),
      page("child", "Child", { parentId: "first" }),
    ];
    expect(findPages(pages, "").map((p) => p.id)).toEqual(["first", "later"]);
    expect(findPages(pages, "", "first").map((p) => p.id)).toEqual(["child"]);
  });

  test("search reaches nested pages by title or ancestor without leaking trash or templates", () => {
    const pages = [
      page("work", "Research"),
      page("child", "Reading list", { parentId: "work" }),
      page("trash", "Research trash", { deletedAt: "2026-11-13" }),
      page("hidden", "Research hidden", { parentId: "trash" }),
      page("template", "Research template", { template: true }),
      page("draft", "Research draft", { parentId: "template" }),
    ];
    expect(findPages(pages, "  RESEARCH ").map((p) => p.id)).toEqual([
      "child",
      "work",
    ]);
    expect(findPages(pages, "reading").map((p) => p.id)).toEqual(["child"]);
    expect(pagePath(pages[1]!, pages)).toBe("Research");
  });

  test("cycles do not hang the page browser and untitled pages stay searchable", () => {
    const pages = [
      page("a", "A", { parentId: "b" }),
      page("b", "B", { parentId: "a" }),
      page("blank", "  "),
    ];
    expect(livePages(pages).map((p) => p.id)).toEqual(["blank"]);
    expect(findPages(pages, "untitled").map((p) => p.id)).toEqual(["blank"]);
    expect(pagePath(pages[0]!, pages)).toBe("B");
  });
});
