import { describe, expect, test } from "bun:test";
import { TZDate } from "@date-fns/tz";
import type { IWhiteboardElement } from "@repo/schemas";
import { boardTodos, buildAgenda, nowLine } from "./dashboard-today";

const todoList = (
  id: string,
  y: number,
  items: { id: string; text: string; completed: boolean }[],
): IWhiteboardElement => ({
  id,
  type: "component",
  componentType: "todo-list",
  x: 0,
  y,
  zIndex: 1,
  data: { items },
});

describe("buildAgenda", () => {
  test("classes become instants in the app's zone, all-day events lead", () => {
    const day = new TZDate(2026, 9, 16, 8, 0, "Europe/Copenhagen");
    const agenda = buildAgenda(
      [
        {
          _id: "e1",
          title: "Dentist",
          date: new Date("2026-10-16T12:00:00Z"),
        },
        {
          _id: "e2",
          title: "Holiday",
          date: new Date("2026-10-15T22:00:00Z"),
          isAllDay: true,
        },
      ],
      [
        {
          _id: "c1",
          title: "Algorithms",
          startTime: "09:15",
          endTime: "11:00",
        },
      ],
      day,
      "Europe/Copenhagen",
    );
    expect(agenda.map((item) => item.id)).toEqual(["e2", "c1", "e1"]);
    expect(agenda[1]).toMatchObject({
      kind: "class",
      start: "2026-10-16T07:15:00.000Z",
      end: "2026-10-16T09:00:00.000Z",
    });
  });
});

describe("boardTodos", () => {
  test("reads lists top to bottom and skips rows without ids", () => {
    const todos = boardTodos([
      todoList("lower", 400, [{ id: "b", text: "Second", completed: true }]),
      todoList("upper", 10, [{ id: "a", text: "First", completed: false }]),
      {
        id: "sticky",
        type: "component",
        componentType: "sticky-note",
        x: 0,
        y: 0,
        zIndex: 2,
        data: { content: "x", colorIndex: 0 },
      },
    ]);
    expect(todos).toEqual([
      { elementId: "upper", itemId: "a", text: "First", completed: false },
      { elementId: "lower", itemId: "b", text: "Second", completed: true },
    ]);
  });
});

describe("nowLine", () => {
  test("the first line without Markdown marks", () => {
    expect(nowLine("\n## Building a **phone** app\nmore")).toBe(
      "Building a phone app",
    );
    expect(nowLine("- reading [Dune](https://x)")).toBe("reading Dune");
    expect(nowLine("")).toBeNull();
    expect(nowLine(undefined)).toBeNull();
  });
});
