import { describe, expect, test } from "bun:test";
import { signInLinkCallbacks, signInLinkErrorMessage } from "./sign-in-link";

const AUTH_APP = "https://auth.denizlg24.com";

describe("signInLinkCallbacks", () => {
  test("lands on /login with the destination as returnTo", () => {
    const { callbackURL, errorCallbackURL } = signInLinkCallbacks(
      AUTH_APP,
      "https://stockwatcher.denizlg24.com/",
    );
    const callback = new URL(callbackURL);
    expect(callback.origin).toBe(AUTH_APP);
    expect(callback.pathname).toBe("/login");
    expect(callback.searchParams.get("returnTo")).toBe(
      "https://stockwatcher.denizlg24.com/",
    );
    expect(callback.searchParams.has("signInLink")).toBe(false);

    const errorCallback = new URL(errorCallbackURL);
    expect(errorCallback.searchParams.get("returnTo")).toBe(
      "https://stockwatcher.denizlg24.com/",
    );
    expect(errorCallback.searchParams.get("signInLink")).toBe("error");
  });

  test("leaves returnTo off for this app's own pages", () => {
    const { callbackURL } = signInLinkCallbacks(AUTH_APP, "/");
    expect(new URL(callbackURL).searchParams.has("returnTo")).toBe(false);
  });

  test("resumes an authorization through its authorize URL", () => {
    const authorize =
      "https://api.denizlg24.com/api/auth/oauth2/authorize?client_id=x&state=s";
    const { callbackURL } = signInLinkCallbacks(AUTH_APP, authorize);
    expect(new URL(callbackURL).searchParams.get("returnTo")).toBe(authorize);
  });
});

describe("signInLinkErrorMessage", () => {
  test("says what to do for each refusal", () => {
    expect(signInLinkErrorMessage("INVALID_TOKEN")).toContain("expired");
    expect(signInLinkErrorMessage(null)).toContain("expired");
    expect(signInLinkErrorMessage("ACCOUNT_UNAVAILABLE")).toContain(
      "can't be used",
    );
    expect(signInLinkErrorMessage("INVALID_LINK")).toContain("isn't complete");
  });
});
