import { beforeEach, describe, expect, test } from "bun:test";
import type { ViewQueryResult, ViewRow } from "@repo/schemas";
import {
  clearViewQueryCache,
  getViewQueryEntry,
  optimisticallyRemoveViewRow,
  setViewQueryResult,
} from "./query-cache";

function query(rows: ViewRow[], total = rows.length): ViewQueryResult {
  return {
    source: "kanban-cards",
    rows,
    total,
    scanned: rows.length,
    truncated: false,
    nextCursor: null,
    groups: [{ key: "Todo", count: total, totals: [] }],
    totals: [],
    options: {},
  };
}

const card: ViewRow = {
  id: "card-1",
  ref: "entity:kanban-card:card-1",
  values: { title: "Ship it", column: "Todo", done: false },
};

const nextCard: ViewRow = {
  id: "card-2",
  ref: "entity:kanban-card:card-2",
  values: { title: "Review it", column: "Todo", done: false },
};

beforeEach(() => clearViewQueryCache());

describe("workspace view cache", () => {
  test("a row is hidden immediately and restored on rollback", () => {
    const entry = getViewQueryEntry({}, "home-work", "column");
    setViewQueryResult(entry, query([card]));

    const optimistic = optimisticallyRemoveViewRow(entry, card);
    expect(entry.state.rows).toEqual([]);
    expect(entry.state.result?.total).toBe(0);
    expect(entry.state.result?.groups[0]?.count).toBe(0);

    optimistic?.rollback();
    expect(entry.state.rows).toEqual([card]);
    expect(entry.state.result?.total).toBe(1);
    expect(entry.state.result?.groups[0]?.count).toBe(1);
  });

  test("a pending hidden row survives replacement and pagination", () => {
    const entry = getViewQueryEntry({}, "home-work", "column");
    setViewQueryResult(entry, {
      ...query([card, nextCard], 2),
      nextCursor: "2",
    });
    const optimistic = optimisticallyRemoveViewRow(entry, nextCard);
    setViewQueryResult(entry, { ...query([card], 2), nextCursor: "2" });
    expect(entry.state.rows).toEqual([card]);
    setViewQueryResult(entry, query([nextCard], 2), true);
    expect(entry.state.rows).toEqual([card]);

    optimistic?.commit();
    setViewQueryResult(entry, query([card, nextCard], 2), true);
    expect(entry.state.rows).toContain(nextCard);
  });

  test("a settled removed row is retired after a complete response", () => {
    const entry = getViewQueryEntry({}, "home-work", "column");
    setViewQueryResult(entry, query([card]));
    const optimistic = optimisticallyRemoveViewRow(entry, card);
    optimistic?.commit();
    setViewQueryResult(entry, query([], 0));
    expect(entry.state.rows).toEqual([]);
    expect(entry.state.result?.total).toBe(0);
  });

  test("same query key shares cached state only within the session", () => {
    const session = {};
    const first = getViewQueryEntry(session, "same", null);
    setViewQueryResult(first, query([card]));
    const second = getViewQueryEntry(session, "same", null);
    expect(second).toBe(first);
    expect(second.state.rows).toEqual([card]);
    expect(getViewQueryEntry({}, "same", null)).not.toBe(first);
  });
});
