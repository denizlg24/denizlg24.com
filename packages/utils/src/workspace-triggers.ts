import type { TriggerCondition, TriggerFilter } from "@repo/schemas";

/*
 * A trigger's filter over an event payload: conditions ANDed, each a typed
 * comparison of one field. A condition naming a field the payload lacks, or
 * comparing across types, never matches — the trigger schema refuses those,
 * so this only meets them in a payload that changed shape.
 */

export type EventPayload = Record<string, string | number | boolean>;

function matches(condition: TriggerCondition, payload: EventPayload): boolean {
  const actual = payload[condition.field];
  const expected = condition.value;
  if (actual === undefined || typeof actual !== typeof expected) return false;
  switch (condition.op) {
    case "eq":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected;
    case "neq":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.toLowerCase() !== expected.toLowerCase()
        : actual !== expected;
    case "contains":
    case "not_contains": {
      if (typeof actual !== "string" || typeof expected !== "string") {
        return false;
      }
      const found = actual.toLowerCase().includes(expected.toLowerCase());
      return condition.op === "contains" ? found : !found;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number") {
        return false;
      }
      if (condition.op === "gt") return actual > expected;
      if (condition.op === "gte") return actual >= expected;
      if (condition.op === "lt") return actual < expected;
      return actual <= expected;
    }
  }
}

export function matchesTriggerFilter(
  filter: TriggerFilter,
  payload: EventPayload,
): boolean {
  return filter.every((condition) => matches(condition, payload));
}

/** The payload as `{{event.<field>}}` values. */
export function eventVariables(payload: EventPayload): Record<string, string> {
  return Object.fromEntries(
    Object.entries(payload).map(([name, value]) => [name, String(value)]),
  );
}
