import { describe, expect, test } from "bun:test";
import { type AmountKey, parseAmount, pressAmountKey } from "./amount-input";

function type(keys: AmountKey[], start = "", replacing = false): string {
  let text = start;
  let first = replacing;
  for (const key of keys) {
    text = pressAmountKey(text, key, first);
    first = false;
  }
  return text;
}

describe("parseAmount", () => {
  test("decimals, with a point or a comma", () => {
    expect(parseAmount("400")).toBe(400);
    expect(parseAmount("1.5")).toBe(1.5);
    expect(parseAmount("1,5")).toBe(1.5);
    expect(parseAmount("2.")).toBe(2);
  });

  test("fractions and mixed numbers", () => {
    expect(parseAmount("1/2")).toBe(0.5);
    expect(parseAmount("1 1/2")).toBe(1.5);
  });

  test("not yet a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(".")).toBeNull();
    expect(parseAmount("1/")).toBeNull();
    expect(parseAmount("1 ")).toBe(1);
    expect(parseAmount("1/0")).toBeNull();
  });
});

describe("pressAmountKey", () => {
  test("the first key replaces the selected amount", () => {
    expect(type(["2", "5", "0"], "400", true)).toBe("250");
    expect(type(["backspace"], "400", true)).toBe("");
  });

  test("backspace removes one character once typing", () => {
    expect(type(["backspace"], "400")).toBe("40");
  });

  test("builds a mixed number", () => {
    expect(type(["1", " ", "1", "/", "2"])).toBe("1 1/2");
  });

  test("ignores keys that cannot make a number", () => {
    expect(type(["1", ".", "5", "."])).toBe("1.5");
    expect(type(["/"])).toBe("");
    expect(type(["1", "/", "/"])).toBe("1/");
    expect(type(["1", ".", "/"])).toBe("1.");
  });

  test("a leading point reads as zero point", () => {
    expect(type(["."])).toBe("0.");
  });

  test("a leading zero gives way to a digit", () => {
    expect(type(["0", "5"])).toBe("5");
  });
});
