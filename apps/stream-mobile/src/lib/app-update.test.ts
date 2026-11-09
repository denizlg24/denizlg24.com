import { describe, expect, test } from "bun:test";

import { formatSize, shouldOffer } from "./app-update";

describe("shouldOffer", () => {
  const now = 1_000_000;
  test("only for a newer version", () => {
    expect(
      shouldOffer({ installed: "0.2.0", latest: "0.2.0", snoozed: null, now }),
    ).toBe(false);
    expect(
      shouldOffer({ installed: "0.2.0", latest: "0.1.9", snoozed: null, now }),
    ).toBe(false);
    expect(
      shouldOffer({ installed: "0.2.0", latest: "0.10.0", snoozed: null, now }),
    ).toBe(true);
  });
  test("Later holds for the day, and only for that version", () => {
    const snoozed = { version: "0.3.0", until: now + 10 };
    expect(
      shouldOffer({ installed: "0.2.0", latest: "0.3.0", snoozed, now }),
    ).toBe(false);
    expect(
      shouldOffer({
        installed: "0.2.0",
        latest: "0.3.0",
        snoozed,
        now: now + 10,
      }),
    ).toBe(true);
    expect(
      shouldOffer({ installed: "0.2.0", latest: "0.3.1", snoozed, now }),
    ).toBe(true);
  });
  test("sizes read in megabytes", () => {
    expect(formatSize(67_674_060)).toBe("68 MB");
    expect(formatSize(null)).toBeNull();
  });
});
