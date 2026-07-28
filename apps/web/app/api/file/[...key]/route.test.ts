import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { publicFileHeaders } = await import("./route");

describe("publicFileHeaders", () => {
  test("allows public assets to render from the desktop app origin", () => {
    const headers = publicFileHeaders({
      contentType: "image/jpeg",
      contentLength: 73_218,
      etag: '"profile-photo"',
      lastModified: new Date("2026-07-28T09:00:00.000Z"),
    });

    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(headers.get("content-type")).toBe("image/jpeg");
    expect(headers.get("content-length")).toBe("73218");
    expect(headers.get("cache-control")).toContain("immutable");
  });
});
