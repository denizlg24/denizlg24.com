import { describe, expect, test } from "bun:test";
import type { IWhiteboardElement } from "@repo/schemas";
import { todayBoardTools } from "./today-board";
import {
  applyComponentItemOps,
  applyElementPatch,
  buildNewElements,
  maxZIndex,
  summarizeElement,
  whiteboardTools,
} from "./whiteboard";

describe("buildNewElements", () => {
  test("assigns ids, z-order, and component default sizes", () => {
    const built = buildNewElements(
      [
        {
          type: "component",
          componentType: "sticky-note",
          x: 10,
          y: 20,
          data: { content: "hi", colorIndex: 2 },
        },
      ],
      5,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const el = built.elements[0];
    expect(el?.id).toBeString();
    expect(el?.zIndex).toBe(6);
    expect(el?.width).toBe(240);
    expect(el?.height).toBe(240);
  });

  test("fills missing todo item ids", () => {
    const built = buildNewElements(
      [
        {
          type: "component",
          componentType: "todo-list",
          x: 0,
          y: 0,
          data: {
            title: "Today",
            items: [{ text: "one", completed: false }],
          },
        },
      ],
      0,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const items = built.elements[0]?.data.items as { id: string }[];
    expect(items[0]?.id).toBeString();
  });

  test("auto-sizes text and defaults arrow endpoints", () => {
    const built = buildNewElements(
      [
        {
          type: "drawing",
          x: 0,
          y: 0,
          data: { text: "hello", color: "#000", fontSize: 16 },
        },
        {
          type: "drawing",
          x: 0,
          y: 0,
          data: { shapeType: "arrow", color: "#000", thickness: 2 },
        },
      ],
      0,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.elements[0]?.width).toBe(260);
    expect(built.elements[0]?.height).toBeGreaterThan(0);
    expect(built.elements[1]?.data.x2).toBe(120);
  });

  test("rejects invalid element data with a readable error", () => {
    const built = buildNewElements(
      [{ type: "drawing", x: 0, y: 0, data: { nonsense: true } }],
      0,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toContain("elements[0]");
  });

  test("rejects unknown component types", () => {
    const built = buildNewElements(
      [{ type: "component", componentType: "widget", x: 0, y: 0, data: {} }],
      0,
    );
    expect(built.ok).toBe(false);
  });
});

describe("applyElementPatch", () => {
  const element: IWhiteboardElement = {
    id: "e1",
    type: "drawing",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    data: { text: "hi", color: "#000", fontSize: 16 },
    zIndex: 1,
  };

  test("merges data shallowly and keeps validity", () => {
    const applied = applyElementPatch(element, {
      x: 50,
      data: { text: "updated" },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.element.x).toBe(50);
    expect(applied.element.data.text).toBe("updated");
    expect(applied.element.data.color).toBe("#000");
  });

  test("rejects patches that break the data schema", () => {
    const applied = applyElementPatch(element, { data: { fontSize: -1 } });
    expect(applied.ok).toBe(false);
  });
});

describe("summaries", () => {
  test("pen strokes summarize without point lists", () => {
    const pen: IWhiteboardElement = {
      id: "p1",
      type: "drawing",
      x: 0,
      y: 0,
      data: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: "#000",
        thickness: 4,
      },
      zIndex: 3,
    };
    const summary = summarizeElement(pen);
    expect(summary).not.toHaveProperty("data");
    expect(summary).toHaveProperty("pointCount", 2);
    expect(maxZIndex([pen])).toBe(3);
  });
});

describe("registration", () => {
  test("both groups expose separate read/write/view tools", () => {
    const names = (tools: { schema: { name: string } }[]) =>
      tools.map((t) => t.schema.name);
    expect(names(whiteboardTools)).toContain("view_whiteboard");
    expect(names(whiteboardTools)).toContain("add_whiteboard_elements");
    expect(names(todayBoardTools)).toContain("view_today_board");
    expect(names(todayBoardTools)).toContain("add_today_board_elements");
    const overlap = names(whiteboardTools).filter((n) =>
      names(todayBoardTools).includes(n),
    );
    expect(overlap).toEqual([]);
  });
});

describe("applyComponentItemOps", () => {
  const checklist = (): IWhiteboardElement => ({
    id: "c1",
    type: "component",
    componentType: "todo-list",
    x: 0,
    y: 0,
    width: 460,
    height: 210,
    zIndex: 1,
    data: {
      items: [
        { id: "a", text: "one", completed: false },
        { id: "b", text: "two", completed: false },
      ],
    },
  });

  test("appends rows with generated ids and a default completed flag", () => {
    const result = applyComponentItemOps(checklist(), {
      add: [{ text: "three" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.element.data.items as {
      id: string;
      text: string;
      completed: boolean;
    }[];
    expect(items).toHaveLength(3);
    expect(items[2]?.text).toBe("three");
    expect(items[2]?.completed).toBe(false);
    expect(items[2]?.id).toBeString();
    expect(result.addedItemIds).toEqual([items[2]?.id ?? ""]);
  });

  test("inserts at an index and leaves the rest in order", () => {
    const result = applyComponentItemOps(checklist(), {
      add: [{ text: "zero" }],
      insertAt: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.element.data.items as { text: string }[];
    expect(items.map((i) => i.text)).toEqual(["zero", "one", "two"]);
  });

  test("ticks a row without touching its siblings", () => {
    const result = applyComponentItemOps(checklist(), {
      update: [{ id: "b", completed: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.element.data.items as {
      id: string;
      text: string;
      completed: boolean;
    }[];
    expect(items[1]).toEqual({ id: "b", text: "two", completed: true });
    expect(items[0]?.completed).toBe(false);
    expect(result.updatedItemIds).toEqual(["b"]);
  });

  test("applies update, remove and add in one write", () => {
    const result = applyComponentItemOps(checklist(), {
      update: [{ id: "a", text: "renamed" }],
      remove: ["b"],
      add: [{ text: "new", completed: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.element.data.items as {
      text: string;
      completed: boolean;
    }[];
    expect(items.map((i) => i.text)).toEqual(["renamed", "new"]);
    expect(items[1]?.completed).toBe(true);
    expect(result.removedItemIds).toEqual(["b"]);
  });

  test("rejects a stale item id instead of silently dropping the edit", () => {
    const result = applyComponentItemOps(checklist(), {
      update: [{ id: "gone", text: "x" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("gone");
  });

  test("rejects components that carry no editable list", () => {
    const sticky: IWhiteboardElement = {
      id: "s1",
      type: "component",
      componentType: "sticky-note",
      x: 0,
      y: 0,
      zIndex: 1,
      data: { content: "hi", colorIndex: 0 },
    };
    const result = applyComponentItemOps(sticky, { add: [{ text: "x" }] });
    expect(result.ok).toBe(false);
  });

  test("rejects an empty operation set", () => {
    expect(applyComponentItemOps(checklist(), {}).ok).toBe(false);
  });

  test("edits quick-links through the same path", () => {
    const links: IWhiteboardElement = {
      id: "q1",
      type: "component",
      componentType: "quick-links",
      x: 0,
      y: 0,
      zIndex: 1,
      data: { title: "Links", links: [{ id: "l1", label: "a", url: "u" }] },
    };
    const result = applyComponentItemOps(links, {
      add: [{ label: "b", url: "v" }],
      remove: ["l1"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.element.data.links as { label: string }[];
    expect(rows.map((r) => r.label)).toEqual(["b"]);
  });
});

describe("component item tools are registered", () => {
  test("both boards expose one", () => {
    expect(
      whiteboardTools.some(
        (t) => t.schema.name === "update_whiteboard_component_items",
      ),
    ).toBe(true);
    expect(
      todayBoardTools.some(
        (t) => t.schema.name === "update_today_board_component_items",
      ),
    ).toBe(true);
  });
});

describe("checklist auto-sizing", () => {
  test("a new checklist is sized to its rows, not the default box", () => {
    const built = buildNewElements(
      [
        {
          type: "component",
          componentType: "todo-list",
          x: 0,
          y: 0,
          data: {
            items: [
              { text: "one", completed: false },
              { text: "two", completed: false },
            ],
          },
        },
      ],
      0,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // two rows plus the action strip, no title
    expect(built.elements[0]?.height).toBe(2 * 42 + 34);
  });

  test("a title adds the header to the height", () => {
    const built = buildNewElements(
      [
        {
          type: "component",
          componentType: "todo-list",
          x: 0,
          y: 0,
          data: {
            title: "Chores",
            items: [{ text: "one", completed: false }],
          },
        },
      ],
      0,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.elements[0]?.height).toBe(30 + 42 + 34);
  });

  test("adding rows grows the element and removing them gives it back", () => {
    const element: IWhiteboardElement = {
      id: "c1",
      type: "component",
      componentType: "todo-list",
      x: 0,
      y: 0,
      width: 460,
      height: 2 * 42 + 34,
      zIndex: 1,
      data: {
        items: [
          { id: "a", text: "one", completed: false },
          { id: "b", text: "two", completed: false },
        ],
      },
    };
    const grown = applyComponentItemOps(element, {
      add: [{ text: "three" }, { text: "four" }],
    });
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    expect(grown.element.height).toBe(4 * 42 + 34);

    const shrunk = applyComponentItemOps(grown.element, {
      remove: ["a", "b"],
    });
    expect(shrunk.ok).toBe(true);
    if (!shrunk.ok) return;
    expect(shrunk.element.height).toBe(2 * 42 + 34);
  });

  test("ticking a row leaves the height alone", () => {
    const element: IWhiteboardElement = {
      id: "c1",
      type: "component",
      componentType: "todo-list",
      x: 0,
      y: 0,
      width: 460,
      height: 42 + 34,
      zIndex: 1,
      data: { items: [{ id: "a", text: "one", completed: false }] },
    };
    const result = applyComponentItemOps(element, {
      update: [{ id: "a", completed: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.element.height).toBe(42 + 34);
  });

  test("quick-links keeps whatever height it was given", () => {
    const element: IWhiteboardElement = {
      id: "q1",
      type: "component",
      componentType: "quick-links",
      x: 0,
      y: 0,
      width: 280,
      height: 320,
      zIndex: 1,
      data: { title: "Links", links: [] },
    };
    const result = applyComponentItemOps(element, {
      add: [{ label: "a", url: "u" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.element.height).toBe(320);
  });
});
