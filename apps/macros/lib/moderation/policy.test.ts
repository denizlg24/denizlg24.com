import { describe, expect, it } from "bun:test";

import { shouldAutoHide } from "./policy";

describe("shouldAutoHide", () => {
  it("hides after three harmful reports", () => {
    expect(
      shouldAutoHide([
        { reason: "offensive" },
        { reason: "spam" },
        { reason: "personal_info" },
      ]),
    ).toBe(true);
  });

  it("never hides over nutrition disagreements", () => {
    expect(
      shouldAutoHide([
        { reason: "incorrect" },
        { reason: "incorrect" },
        { reason: "incorrect" },
        { reason: "offensive" },
        { reason: "other" },
      ]),
    ).toBe(false);
  });
});
