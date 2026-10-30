import { describe, expect, test } from "bun:test";
import { parseDomainEvent, triggerInputSchema } from "@repo/schemas";
import { eventVariables, matchesTriggerFilter } from "./workspace-triggers";

const payload = {
  cardId: "c1",
  boardId: "b1",
  boardTitle: "Life",
  title: "Renew passport",
  fromColumnId: "x",
  fromColumnTitle: "Doing",
  toColumnId: "y",
  toColumnTitle: "Done",
  done: true,
};

describe("trigger filters", () => {
  test("conditions are ANDed; strings compare case-insensitively", () => {
    expect(matchesTriggerFilter([], payload)).toBe(true);
    expect(
      matchesTriggerFilter(
        [
          { field: "done", op: "eq", value: true },
          { field: "boardTitle", op: "eq", value: "life" },
          { field: "title", op: "contains", value: "PASS" },
        ],
        payload,
      ),
    ).toBe(true);
    expect(
      matchesTriggerFilter(
        [
          { field: "done", op: "eq", value: true },
          { field: "title", op: "not_contains", value: "passport" },
        ],
        payload,
      ),
    ).toBe(false);
  });

  test("numbers compare; a missing field or mismatched type never matches", () => {
    const triaged = { confidence: 0.92, category: "urgent" };
    expect(
      matchesTriggerFilter(
        [{ field: "confidence", op: "gte", value: 0.9 }],
        triaged,
      ),
    ).toBe(true);
    expect(
      matchesTriggerFilter(
        [{ field: "confidence", op: "lt", value: 0.5 }],
        triaged,
      ),
    ).toBe(false);
    expect(
      matchesTriggerFilter([{ field: "nope", op: "eq", value: "x" }], triaged),
    ).toBe(false);
    expect(
      matchesTriggerFilter(
        [{ field: "confidence", op: "eq", value: "0.92" }],
        triaged,
      ),
    ).toBe(false);
  });

  test("event variables are strings", () => {
    expect(eventVariables({ a: 1, b: true, c: "x" })).toEqual({
      a: "1",
      b: "true",
      c: "x",
    });
  });
});

describe("trigger schema", () => {
  const base = {
    name: "Done → log",
    event: "kanban.card.moved" as const,
    action: {
      kind: "actions" as const,
      actions: [
        {
          kind: "append-blocks" as const,
          pageId: "journal",
          markdown: "- {{event.title}}",
        },
      ],
    },
  };

  test("a filter is typed against the event's fields", () => {
    expect(
      triggerInputSchema.safeParse({
        ...base,
        filter: [{ field: "done", op: "eq", value: true }],
      }).success,
    ).toBe(true);
    expect(
      triggerInputSchema.safeParse({
        ...base,
        filter: [{ field: "amountMinor", op: "gt", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      triggerInputSchema.safeParse({
        ...base,
        filter: [{ field: "done", op: "gt", value: true }],
      }).success,
    ).toBe(false);
    expect(
      triggerInputSchema.safeParse({
        ...base,
        filter: [{ field: "title", op: "eq", value: 3 }],
      }).success,
    ).toBe(false);
  });

  test("schedules belong to schedule triggers; $this to none", () => {
    expect(
      triggerInputSchema.safeParse({
        ...base,
        event: "schedule.tick",
      }).success,
    ).toBe(false);
    expect(
      triggerInputSchema.safeParse({
        ...base,
        event: "schedule.tick",
        schedule: { cron: "0 7 * * *", timeZone: "UTC" },
      }).success,
    ).toBe(true);
    expect(
      triggerInputSchema.safeParse({
        ...base,
        action: {
          kind: "actions",
          actions: [{ kind: "append-blocks", markdown: "x" }],
        },
      }).success,
    ).toBe(false);
  });

  test("events parse against their field table", () => {
    expect(
      parseDomainEvent({ type: "kanban.card.moved", payload }),
    ).not.toBeNull();
    expect(
      parseDomainEvent({
        type: "kanban.card.moved",
        payload: { ...payload, done: "yes" },
      }),
    ).toBeNull();
    expect(parseDomainEvent({ type: "nope", payload: {} })).toBeNull();
  });
});
