import { expect, test } from "bun:test";
import { cn } from "./utils";

test("cn merges class names", () => {
  expect(cn("a", "b")).toBe("a b");
});
