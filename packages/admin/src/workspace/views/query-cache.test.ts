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

beforeEach(() => clearViewQueryCache());

describe("workspace view cache", () => {
  test("a row is hidden immediately and restored on rollback", () => {
    const entry = getViewQueryEntry({}, "home-work", "column");
    setViewQueryResult(entry, query([card]));

    const rollback = optimisticallyRemoveViewRow(entry, card.id);
    expect(entry.state.rows).toEqual([]);
    expect(entry.state.result?.total).toBe(0);
    expect(entry.state.result?.groups[0]?.count).toBe(0);

    rollback();
    expect(entry.state.rows).toEqual([card]);
    expect(entry.state.result?.total).toBe(1);
    expect(entry.state.result?.groups[0]?.count).toBe(1);
  });

  test("server confirmation retires the optimistic overlay", () => {
    const entry = getViewQueryEntry({}, "home-work", "column");
    setViewQueryResult(entry, query([card]));
    optimisticallyRemoveViewRow(entry, card.id);

    setViewQueryResult(entry, query([], 0));
    expect(entry.state.rows).toEqual([]);
    expect(entry.state.result?.total).toBe(0);
  });

  test("same query key shares the cached state within a session", () => {
    const session = {};
    const first = getViewQueryEntry(session, "same", null);
    setViewQueryResult(first, query([card]));
    const second = getViewQueryEntry(session, "same", null);
    expect(second).toBe(first);
    expect(second.state.rows).toEqual([card]);
  });

  test("different sessions do not share cached rows", () => {
    const first = getViewQueryEntry({}, "same", null);
    const second = getViewQueryEntry({}, "same", null);
    expect(second).not.toBe(first);
  });
});
