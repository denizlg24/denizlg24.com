import { describe, expect, test } from "bun:test";
import { describeLastActive, describeUserAgent } from "./device-labels";

describe("describeUserAgent", () => {
  test("names the native apps", () => {
    expect(
      describeUserAgent("Macros/14 CFNetwork/3826.500.111 Darwin/25.0.0"),
    ).toBe("Macros for iPhone");
    expect(describeUserAgent("okhttp/4.12.0")).toBe("Macros for Android");
  });

  test("names the browser and the platform", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Mac");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
      ),
    ).toBe("Firefox on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Chrome on iPhone");
  });

  test("falls back when the agent says too little", () => {
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("")).toBe("Unknown device");
    expect(describeUserAgent("curl/8.7.1")).toBe("Unknown device");
  });
});

describe("describeLastActive", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const before = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  test("counts whole days", () => {
    expect(describeLastActive(before(3), now)).toBe("Active today");
    expect(describeLastActive(before(30), now)).toBe("Active yesterday");
    expect(describeLastActive(before(24 * 5 + 2), now)).toBe(
      "Active 5 days ago",
    );
  });

  test("switches to months after thirty days", () => {
    expect(describeLastActive(before(24 * 40), now)).toBe("Active last month");
    expect(describeLastActive(before(24 * 75), now)).toBe(
      "Active 2 months ago",
    );
  });

  test("treats clock skew as now", () => {
    expect(describeLastActive(before(-2), now)).toBe("Active today");
  });
});
