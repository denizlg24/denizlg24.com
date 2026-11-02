import { describe, expect, test } from "bun:test";
import {
  daysUntil,
  evalWhen,
  getPath,
  interpolate,
  resolveNumber,
  resolveValue,
} from "./ui-spec";

const scope = {
  tasks: {
    rows: [
      { title: "A", n: 2 },
      { title: "B", n: 3 },
    ],
    total: 2,
  },
  props: { name: "deniz", empty: "" },
  constructor: "x",
};

describe("ui-spec", () => {
  test("paths walk records and arrays", () => {
    expect(getPath(scope, "tasks.rows.1.title")).toBe("B");
    expect(getPath(scope, "tasks.rows.length")).toBe(2);
    expect(getPath(scope, "tasks.missing.deep")).toBeUndefined();
    expect(getPath({}, "toString")).toBeUndefined();
  });

  test("placeholders interpolate with pipes", () => {
    expect(
      interpolate("Hi {{ props.name | upper }}, {{tasks.total}} left", scope),
    ).toBe("Hi DENIZ, 2 left");
    expect(interpolate("{{props.empty | default:none}}", scope)).toBe("none");
    expect(interpolate("{{tasks.rows | count}}", scope)).toBe("2");
    expect(interpolate("{{ratio | percent}}", { ratio: 0.256 })).toBe("26%");
  });

  test("a lone placeholder keeps its value", () => {
    expect(resolveValue("{{tasks.rows}}", scope)).toEqual(scope.tasks.rows);
    expect(resolveNumber("{{tasks.rows.0.n}}", scope)).toBe(2);
    expect(resolveNumber("7", scope)).toBe(7);
  });

  test("when and countdowns", () => {
    expect(evalWhen("tasks.rows", scope)).toBe(true);
    expect(evalWhen("!props.empty", scope)).toBe(true);
    expect(daysUntil("2026-12-25", "2026-11-01")).toBe(54);
  });
});
