import { expect, test } from "bun:test";
import { snippetAround } from "./snippet";

test("cuts around the match on word boundaries", () => {
  const text = `${"alpha ".repeat(30)}the Nasdaq rebound lifted ${"beta ".repeat(30)}`;
  const snippet = snippetAround(text, "nasdaq");
  expect(snippet?.startsWith("…")).toBe(true);
  expect(snippet?.endsWith("…")).toBe(true);
  expect(snippet).toContain("the Nasdaq rebound lifted");
  expect(snippet).not.toMatch(/…\S*alph[^a]/);
});

test("short text comes back whole, a miss is null", () => {
  expect(snippetAround("Gold ETC had no change", "gold")).toBe(
    "Gold ETC had no change",
  );
  expect(snippetAround("nothing here", "nvda")).toBeNull();
});
