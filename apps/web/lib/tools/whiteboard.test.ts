import { describe, expect, test } from "bun:test";
import type { IWhiteboardElement } from "@repo/schemas";
import { todayBoardTools } from "./today-board";
import {
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
