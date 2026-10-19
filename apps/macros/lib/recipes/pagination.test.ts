import { describe, expect, it } from "bun:test";
import {
  PUBLIC_RECIPES_PAGE_SIZE,
  parseRecipePage,
  recipeBrowsePath,
  recipePageCount,
  recipePageParams,
} from "./pagination";

describe("recipe pagination", () => {
  it("always has a first page", () => {
    expect(recipePageCount(0)).toBe(1);
    expect(recipePageCount(PUBLIC_RECIPES_PAGE_SIZE)).toBe(1);
    expect(recipePageCount(PUBLIC_RECIPES_PAGE_SIZE + 1)).toBe(2);
  });

  it("puts page 1 at /recipes", () => {
    expect(recipeBrowsePath(1)).toBe("/recipes");
    expect(recipeBrowsePath(3)).toBe("/recipes/page/3");
  });

  it("only accepts canonical numbers from 2", () => {
    expect(parseRecipePage("2")).toBe(2);
    expect(parseRecipePage("10")).toBe(10);
    for (const raw of ["1", "0", "02", "-2", "2.5", "abc", "", "123456"])
      expect(parseRecipePage(raw)).toBeNull();
  });

  it("pre-renders every page after the first", () => {
    expect(recipePageParams(0)).toEqual([]);
    expect(recipePageParams(PUBLIC_RECIPES_PAGE_SIZE * 2 + 1)).toEqual([
      { n: "2" },
      { n: "3" },
    ]);
  });
});
