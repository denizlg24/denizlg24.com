import { describe, expect, test } from "bun:test";
import type { IWhiteboardElement } from "@repo/schemas";
import { buildNewElements } from "./whiteboard-elements";

const sticky = (x: number, y: number): IWhiteboardElement => ({
  id: `s-${x}-${y}`,
  type: "component",
  componentType: "sticky-note",
  x,
  y,
  width: 200,
  height: 100,
  zIndex: 1,
  data: { content: "", colorIndex: 0 },
});

const todo = {
  type: "component" as const,
  componentType: "todo-list" as const,
  data: { items: [{ text: "Milk", completed: false }] },
};

describe("buildNewElements placement", () => {
  test("an element without coordinates goes below the lowest one, left-aligned", () => {
    const built = buildNewElements([todo], [sticky(100, 0), sticky(40, 300)]);
    if (!built.ok) throw new Error(built.error);
    expect(built.elements[0]).toMatchObject({ x: 40, y: 440 });
  });

  test("several placed at once stack instead of overlapping", () => {
    const built = buildNewElements([todo, todo], [sticky(0, 0)]);
    if (!built.ok) throw new Error(built.error);
    const [first, second] = built.elements;
    if (!first || !second) throw new Error("missing elements");
    expect(second.y).toBeGreaterThanOrEqual(first.y + (first.height ?? 0));
  });

  test("given coordinates are kept and an empty board starts at the origin", () => {
    const placed = buildNewElements([{ ...todo, x: 5, y: 7 }], [sticky(0, 0)]);
    const empty = buildNewElements([todo], []);
    if (!placed.ok || !empty.ok) throw new Error("build failed");
    expect(placed.elements[0]).toMatchObject({ x: 5, y: 7 });
    expect(empty.elements[0]).toMatchObject({ x: 0, y: 0 });
  });
});
