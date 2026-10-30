import { describe, expect, test } from "bun:test";
import {
  VIEW_SOURCES,
  type ViewConfig,
  type ViewRow,
  viewConfigSchema,
} from "@repo/schemas";
import { runViewQuery, viewConfigProblems } from "./workspace-views";

const TODAY = "2026-10-30";
const cards = VIEW_SOURCES["kanban-cards"];
const entries = VIEW_SOURCES["finance-entries"];

const config = (input: Partial<ViewConfig> & Pick<ViewConfig, "source">) =>
  viewConfigSchema.parse(input);

const card = (
  id: string,
  values: Partial<{
    title: string;
    column: string;
    done: boolean;
    due: string | null;
    labels: string[];
    priority: string;
    people: { id: string; name: string }[];
  }>,
): ViewRow => ({
  id,
  ref: `entity:kanban-card:${id}`,
  values: {
    title: id,
    board: "Life",
    column: "Todo",
    done: false,
    due: null,
    labels: [],
    priority: "none",
    people: [],
    ...values,
  },
});

const CARDS: ViewRow[] = [
  card("a", { due: "2026-10-31", labels: ["home"], priority: "high" }),
  card("b", { due: "2026-11-20", column: "Doing", labels: ["work", "home"] }),
  card("c", { column: "Done", done: true, due: "2026-10-29" }),
  card("d", { due: "2026-11-02T09:00:00.000Z", priority: "urgent" }),
  card("e", { people: [{ id: "p1", name: "Ana" }] }),
];

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("filters", () => {
  test("relative dates, booleans and multi-value selects compose with AND", () => {
    const result = runViewQuery(
      cards,
      CARDS,
      config({
        source: "kanban-cards",
        filters: [
          { field: "due", op: "next_days", value: 7 },
          { field: "done", op: "is", value: false },
        ],
      }),
      { today: TODAY },
    );
    expect(ids(result.rows)).toEqual(["a", "d"]);
    expect(result.total).toBe(2);

    const home = runViewQuery(
      cards,
      CARDS,
      config({
        source: "kanban-cards",
        filters: [{ field: "labels", op: "is", value: "home" }],
      }),
      { today: TODAY },
    );
    expect(ids(home.rows).sort()).toEqual(["a", "b"]);
  });

  test("negative operators keep rows with no value; positive ones drop them", () => {
    const run = (op: "is" | "is_not" | "empty") =>
      ids(
        runViewQuery(
          cards,
          CARDS,
          config({
            source: "kanban-cards",
            filters: [{ field: "people", op, value: "ana" }],
          }),
          { today: TODAY },
        ).rows,
      ).sort();
    expect(run("is")).toEqual(["e"]);
    expect(run("is_not")).toEqual(["a", "b", "c", "d"]);
    expect(run("empty")).toEqual(["a", "b", "c", "d"]);
  });

  test("fields and operators a source does not have are reported and skipped", () => {
    const bad = config({
      source: "kanban-cards",
      filters: [
        { field: "nope", op: "is", value: "x" },
        { field: "due", op: "contains", value: "x" },
      ],
      group: "due",
    });
    expect(viewConfigProblems(cards, bad)).toHaveLength(3);
    expect(runViewQuery(cards, CARDS, bad, { today: TODAY }).total).toBe(5);
  });
});

describe("sort, group and pages", () => {
  test("empty values sort last both ways; ties fall back to the default sort", () => {
    const asc = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", sort: [{ field: "due", dir: "asc" }] }),
      { today: TODAY },
    );
    expect(ids(asc.rows)).toEqual(["c", "a", "d", "b", "e"]);
    const desc = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", sort: [{ field: "due", dir: "desc" }] }),
      { today: TODAY },
    );
    expect(ids(desc.rows)).toEqual(["b", "d", "a", "c", "e"]);
  });

  test("a select with fixed options groups in their order; multi values count in each group", () => {
    const byPriority = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", group: "priority" }),
      { today: TODAY },
    );
    expect(byPriority.groups.map((g) => [g.key, g.count])).toEqual([
      ["none", 3],
      ["high", 1],
      ["urgent", 1],
    ]);
    const byLabel = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", group: "labels" }),
      { today: TODAY },
    );
    expect(byLabel.groups.map((g) => [g.key, g.count])).toEqual([
      ["home", 2],
      ["work", 1],
      ["", 3],
    ]);
  });

  test("a board groups by the source's default when the view names none", () => {
    const board = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", layout: "board" }),
      { today: TODAY },
    );
    expect(board.groups.map((g) => g.key)).toEqual(["Doing", "Done", "Todo"]);
  });

  test("pages by cursor; totals and groups cover every matching row", () => {
    const first = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", limit: 2 }),
      { today: TODAY },
    );
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBe("2");
    const last = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards", limit: 2 }),
      { today: TODAY, cursor: 4 },
    );
    expect(last.rows).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
  });

  test("select options are learned from the rows when the source has none fixed", () => {
    const result = runViewQuery(
      cards,
      CARDS,
      config({ source: "kanban-cards" }),
      { today: TODAY },
    );
    expect(result.options.column).toEqual(["Doing", "Done", "Todo"]);
    expect(result.options.labels).toEqual(["home", "work"]);
    expect(result.options.priority).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });
});

describe("money", () => {
  const entry = (
    id: string,
    amountMinor: number,
    currency: string,
    category: string,
  ): ViewRow => ({
    id,
    ref: null,
    values: {
      description: id,
      amount: { amountMinor, currency },
      currency,
      date: "2026-10-01",
      category,
    },
  });
  const ROWS = [
    entry("rent", -90_000, "EUR", "Housing"),
    entry("groceries", -4_520, "EUR", "Food"),
    entry("smorrebrod", -12_500, "DKK", "Food"),
    entry("salary", 250_000, "EUR", "Income"),
  ];

  test("totals are per currency, never summed across currencies", () => {
    const result = runViewQuery(
      entries,
      ROWS,
      config({ source: "finance-entries" }),
      { today: TODAY },
    );
    expect(result.totals).toEqual([
      { field: "amount", currency: "DKK", amountMinor: -12_500 },
      { field: "amount", currency: "EUR", amountMinor: 155_480 },
    ]);
  });

  test("a group's totals are per currency too", () => {
    const result = runViewQuery(
      entries,
      ROWS,
      config({ source: "finance-entries", group: "category" }),
      { today: TODAY },
    );
    const food = result.groups.find((g) => g.key === "Food");
    expect(food?.totals).toEqual([
      { field: "amount", currency: "DKK", amountMinor: -12_500 },
      { field: "amount", currency: "EUR", amountMinor: -4_520 },
    ]);
  });

  test("money filters compare minor units in the row's own currency", () => {
    const result = runViewQuery(
      entries,
      ROWS,
      config({
        source: "finance-entries",
        filters: [{ field: "amount", op: "lt", value: -10_000 }],
      }),
      { today: TODAY },
    );
    expect(ids(result.rows).sort()).toEqual(["rent", "smorrebrod"]);
  });
});
