import { describe, expect, test } from "bun:test";
import {
  authorizeUrl,
  isAuthorizationRedirect,
  isProviderRedirect,
} from "./authorization";

const signed = new URLSearchParams([
  ["response_type", "code"],
  ["client_id", "claude"],
  ["redirect_uri", "http://localhost:33418/callback"],
  ["scope", "openid offline_access"],
  ["resource", "https://mcp.denizlg24.com/mcp"],
  ["state", "s1"],
  ["prompt", "login consent"],
  ["exp", "1789239217"],
  ["ba_iat", "1789238617000"],
  ["ba_param", "client_id"],
  ["ba_param", "state"],
  ["sig", "abc"],
]);

describe("isAuthorizationRedirect", () => {
  test("recognises a signed provider redirect", () => {
    expect(isAuthorizationRedirect(signed)).toBe(true);
  });

  test("treats a plain returnTo sign-in as ordinary", () => {
    expect(
      isAuthorizationRedirect(
        new URLSearchParams({ returnTo: "https://forge.denizlg24.com/" }),
      ),
    ).toBe(false);
  });
});

describe("authorizeUrl", () => {
  test("rebuilds the original request without the signature or the login prompt", () => {
    const url = new URL(authorizeUrl(signed));
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    for (const key of ["sig", "exp", "ba_iat", "ba_param", "ba_pl"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("client_id")).toBe("claude");
    expect(url.searchParams.get("resource")).toBe(
      "https://mcp.denizlg24.com/mcp",
    );
  });

  test("drops prompt entirely when login was all it asked for", () => {
    const params = new URLSearchParams(signed);
    params.set("prompt", "login");
    expect(new URL(authorizeUrl(params)).searchParams.has("prompt")).toBe(
      false,
    );
  });
});

describe("isProviderRedirect", () => {
  test("accepts only the provider's redirect envelope", () => {
    expect(isProviderRedirect({ redirect: true, url: "https://x" })).toBe(true);
    expect(isProviderRedirect({ redirect: false, url: "https://x" })).toBe(
      false,
    );
    expect(isProviderRedirect({ twoFactorRedirect: true })).toBe(false);
    expect(isProviderRedirect(null)).toBe(false);
  });
});
