import { describe, expect, test } from "bun:test";
import { pathFromUrl } from "./routing";

describe("pathFromUrl", () => {
  test("maps our scheme to a path and ignores everything else", () => {
    expect(pathFromUrl("dashboard://inbox/triage/abc")).toBe(
      "/inbox/triage/abc",
    );
    expect(pathFromUrl("dashboard://money?view=budget")).toBe(
      "/money?view=budget",
    );
    expect(pathFromUrl("https://example.com")).toBeNull();
    expect(pathFromUrl(undefined)).toBeNull();
  });
});
