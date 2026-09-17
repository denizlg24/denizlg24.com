import { describe, expect, test } from "bun:test";
import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  test("names Safari on an iPhone", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ).label,
    ).toBe("Safari on iPhone");
  });

  test("does not mistake Chrome or Edge for Safari", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    expect(describeUserAgent(chrome).label).toBe("Chrome on Mac");
    expect(describeUserAgent(`${chrome} Edg/140.0.0.0`).label).toBe(
      "Edge on Mac",
    );
    expect(
      describeUserAgent(chrome.replace("Chrome/", "HeadlessChrome/")).label,
    ).toBe("Chrome on Mac");
  });

  test("names the iOS builds of Chrome and Firefox", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
      ).label,
    ).toBe("Chrome on iPhone");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
      ).label,
    ).toBe("Firefox on iPad");
  });

  test("names Firefox on Windows and Chrome on Android", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
      ).label,
    ).toBe("Firefox on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      ).label,
    ).toBe("Chrome on Android");
  });

  test("degrades to whichever half it can read", () => {
    expect(describeUserAgent("curl/8.7.1").label).toBe("Unknown device");
    expect(describeUserAgent("Bun/1.4.0").label).toBe("Unknown device");
    expect(describeUserAgent("").label).toBe("Unknown device");
    expect(describeUserAgent(null).label).toBe("Unknown device");
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").label,
    ).toBe("Windows");
  });
});
