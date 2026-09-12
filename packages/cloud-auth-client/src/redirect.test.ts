import { describe, expect, test } from "bun:test";
import { safeReturnTo } from "./redirect";

describe("safeReturnTo", () => {
  test("allows the apex and every host under the cookie domain", () => {
    expect(safeReturnTo("https://denizlg24.com/admin")).toBe(
      "https://denizlg24.com/admin",
    );
    expect(safeReturnTo("https://forge.denizlg24.com/x?y=1")).toBe(
      "https://forge.denizlg24.com/x?y=1",
    );
    expect(safeReturnTo("https://app-abc123.denizlg24.com/")).toBe(
      "https://app-abc123.denizlg24.com/",
    );
  });

  test("refuses anything that would leave the cookie domain", () => {
    for (const value of [
      "https://evil.com",
      "https://denizlg24.com.evil.com/",
      "https://evildenizlg24.com/",
      "http://forge.denizlg24.com/",
      "https://forge.denizlg24.com:8443/",
      "https://user:pass@forge.denizlg24.com/",
      "//evil.com",
      "/relative",
      "javascript:alert(1)",
      "",
    ]) {
      expect(safeReturnTo(value)).toBeNull();
    }
  });

  test("allows plain-http loopback only when asked to", () => {
    expect(safeReturnTo("http://localhost:3006/")).toBeNull();
    expect(
      safeReturnTo("http://localhost:3006/", { allowLoopback: true }),
    ).toBe("http://localhost:3006/");
    expect(
      safeReturnTo("http://evil.com/", { allowLoopback: true }),
    ).toBeNull();
  });
});
