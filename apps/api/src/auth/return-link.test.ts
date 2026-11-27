import { describe, expect, it } from "bun:test";

import { registeredReturnUrl } from "./return-link";

const REDIRECTS = [
  "https://stockwatcher.denizlg24.com/auth/callback",
  "http://localhost:3013/auth/callback",
  "com.example.app:/oauth/callback",
];

describe("registeredReturnUrl", () => {
  it("accepts any page on a registered https origin", () => {
    expect(
      registeredReturnUrl(
        "https://stockwatcher.denizlg24.com/account#security",
        REDIRECTS,
      ),
    ).toBe("https://stockwatcher.denizlg24.com/account#security");
  });

  it("accepts a registered loopback origin over http", () => {
    expect(
      registeredReturnUrl("http://localhost:3013/account", REDIRECTS),
    ).toBe("http://localhost:3013/account");
  });

  it("refuses origins the client never registered", () => {
    for (const value of [
      "https://evil.example/account",
      "https://stockwatcher.denizlg24.com.evil.example/",
      "https://forge.denizlg24.com/",
      "http://stockwatcher.denizlg24.com/account",
      "https://stockwatcher.denizlg24.com:8443/account",
      "http://localhost:4000/account",
    ]) {
      expect(registeredReturnUrl(value, REDIRECTS)).toBeNull();
    }
  });

  it("refuses non-web schemes and credentials", () => {
    for (const value of [
      "javascript:alert(1)",
      "com.example.app:/oauth/callback",
      "https://user:pass@stockwatcher.denizlg24.com/",
      "not a url",
    ]) {
      expect(registeredReturnUrl(value, REDIRECTS)).toBeNull();
    }
  });

  it("refuses plain http for a non-loopback host even when registered", () => {
    expect(
      registeredReturnUrl("http://app.example/account", [
        "http://app.example/callback",
      ]),
    ).toBeNull();
  });
});
