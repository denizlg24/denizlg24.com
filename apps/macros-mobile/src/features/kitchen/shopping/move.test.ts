import { describe, expect, test } from "bun:test";
import { moveOffsets } from "./move";

describe("moveOffsets", () => {
  const list = ["a", "b", "c", "d"];

  test("moves a row down past its neighbours", () => {
    expect(moveOffsets(list, [0], 3)).toEqual(["b", "c", "a", "d"]);
  });

  test("moves a row to the very end", () => {
    expect(moveOffsets(list, [0], 4)).toEqual(["b", "c", "d", "a"]);
  });

  test("moves a row up", () => {
    expect(moveOffsets(list, [3], 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("dropping a row where it already is changes nothing", () => {
    expect(moveOffsets(list, [1], 1)).toEqual(list);
    expect(moveOffsets(list, [1], 2)).toEqual(list);
  });

  test("keeps the relative order of several moved rows", () => {
    expect(moveOffsets(list, [0, 2], 4)).toEqual(["b", "d", "a", "c"]);
  });
});
