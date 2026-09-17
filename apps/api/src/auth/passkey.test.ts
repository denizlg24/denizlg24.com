import { describe, expect, it } from "bun:test";

import { assertUserVerified, passkeyRelyingParty } from "./passkey";

describe("passkeyRelyingParty", () => {
  it("binds to the cookie domain and pins ceremonies to the auth app", () => {
    expect(
      passkeyRelyingParty({
        authAppUrl: "https://auth.denizlg24.com",
        cookieDomain: ".denizlg24.com",
      }),
    ).toEqual({
      rpId: "denizlg24.com",
      origins: ["https://auth.denizlg24.com"],
    });
  });

  it("falls back to the auth app host without a cookie domain", () => {
    expect(
      passkeyRelyingParty({ authAppUrl: "http://localhost:3008/" }),
    ).toEqual({
      rpId: "localhost",
      origins: ["http://localhost:3008"],
    });
  });

  it("prefers an explicit rpId over both", () => {
    expect(
      passkeyRelyingParty({
        authAppUrl: "https://auth.denizlg24.com",
        cookieDomain: ".denizlg24.com",
        rpId: "auth.denizlg24.com",
      }).rpId,
    ).toBe("auth.denizlg24.com");
  });

  it("drops a path or query from the auth app URL", () => {
    expect(
      passkeyRelyingParty({
        authAppUrl: "https://auth.denizlg24.com/login?x=1",
      }).origins,
    ).toEqual(["https://auth.denizlg24.com"]);
  });
});

describe("assertUserVerified", () => {
  it("refuses an assertion without user verification", () => {
    expect(() => assertUserVerified(false)).toThrow(
      "Passkey sign-in requires user verification",
    );
    expect(() => assertUserVerified(true)).not.toThrow();
  });
});
