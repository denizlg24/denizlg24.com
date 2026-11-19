import { describe, expect, it } from "bun:test";

import { signInLinkEmail } from "./email";
import { authMailerFromEnv } from "./public-accounts-config";
import {
  isAllowedSignInLinkCallback,
  isAllowedSignInLinkTarget,
  type SignInLinkAccount,
  type SignInLinkTargets,
  signInLinkCallback,
  signInLinkLandingUrl,
  signInLinkRefusal,
} from "./sign-in-link";

const AUTH_APP = "https://auth.denizlg24.com";
const API = "https://api.denizlg24.com";
const STOCKWATCHER = "https://stockwatcher.denizlg24.com";

const targets: SignInLinkTargets = {
  authAppUrl: AUTH_APP,
  apiUrl: API,
  origins: new Set(["https://storage.denizlg24.com", STOCKWATCHER]),
};

const eligible: SignInLinkAccount = {
  realm: "cloud",
  status: "active",
  banned: false,
  emailVerified: true,
  twoFactorEnabled: true,
};

describe("signInLinkRefusal", () => {
  it("lets an active, confirmed, enrolled cloud account in", () => {
    expect(signInLinkRefusal(eligible)).toBeNull();
  });

  it("does not ask a public account for a second factor", () => {
    expect(
      signInLinkRefusal({
        ...eligible,
        realm: "public",
        twoFactorEnabled: false,
      }),
    ).toBeNull();
  });

  it("refuses missing, banned and pending accounts alike", () => {
    expect(signInLinkRefusal(undefined)).toBe("ACCOUNT_UNAVAILABLE");
    expect(signInLinkRefusal({ ...eligible, banned: true })).toBe(
      "ACCOUNT_UNAVAILABLE",
    );
    expect(signInLinkRefusal({ ...eligible, status: "pending" })).toBe(
      "ACCOUNT_UNAVAILABLE",
    );
  });

  it("refuses an address that was never confirmed", () => {
    expect(signInLinkRefusal({ ...eligible, emailVerified: false })).toBe(
      "EMAIL_NOT_VERIFIED",
    );
  });

  it("refuses a cloud account that has not enrolled its second factor", () => {
    expect(signInLinkRefusal({ ...eligible, twoFactorEnabled: false })).toBe(
      "MFA_ENROLLMENT_REQUIRED",
    );
  });
});

describe("isAllowedSignInLinkTarget", () => {
  it("allows the auth app, listed origins and the authorize endpoint", () => {
    expect(isAllowedSignInLinkTarget(`${AUTH_APP}/account`, targets)).toBe(
      true,
    );
    expect(isAllowedSignInLinkTarget(`${STOCKWATCHER}/`, targets)).toBe(true);
    expect(
      isAllowedSignInLinkTarget(
        `${API}/api/auth/oauth2/authorize?client_id=x`,
        targets,
      ),
    ).toBe(true);
  });

  it("refuses anything else on the API", () => {
    expect(isAllowedSignInLinkTarget(`${API}/api/me`, targets)).toBe(false);
    expect(isAllowedSignInLinkTarget(`${API}/api/auth/sign-out`, targets)).toBe(
      false,
    );
  });

  it("refuses unlisted, look-alike and credentialed URLs", () => {
    for (const value of [
      "https://evil.example/",
      "https://stockwatcher.denizlg24.com.evil.example/",
      "http://stockwatcher.denizlg24.com/",
      "https://user:pass@stockwatcher.denizlg24.com/",
      "javascript:alert(1)",
      "/relative",
      "",
    ]) {
      expect(isAllowedSignInLinkTarget(value, targets)).toBe(false);
    }
  });
});

describe("isAllowedSignInLinkCallback", () => {
  it("accepts the auth app's login with an allowed returnTo", () => {
    expect(
      isAllowedSignInLinkCallback(
        signInLinkCallback(AUTH_APP, `${STOCKWATCHER}/`),
        targets,
      ),
    ).toBe(true);
    expect(
      isAllowedSignInLinkCallback(signInLinkCallback(AUTH_APP), targets),
    ).toBe(true);
  });

  it("accepts the error landing only on the error callback", () => {
    const errorCallback = signInLinkCallback(
      AUTH_APP,
      `${STOCKWATCHER}/`,
      "error",
    );
    expect(isAllowedSignInLinkCallback(errorCallback, targets)).toBe(false);
    expect(
      isAllowedSignInLinkCallback(errorCallback, targets, {
        errorCallback: true,
      }),
    ).toBe(true);
    expect(
      isAllowedSignInLinkCallback(
        signInLinkCallback(AUTH_APP, undefined, "challenge"),
        targets,
        { errorCallback: true },
      ),
    ).toBe(false);
  });

  it("refuses a missing, relative or foreign callback", () => {
    expect(isAllowedSignInLinkCallback(undefined, targets)).toBe(false);
    expect(isAllowedSignInLinkCallback("/", targets)).toBe(false);
    expect(
      isAllowedSignInLinkCallback("https://cloud.denizlg24.com/", targets),
    ).toBe(false);
    expect(isAllowedSignInLinkCallback(`${AUTH_APP}/account`, targets)).toBe(
      false,
    );
  });

  it("refuses a returnTo outside the allow-list, or more than one", () => {
    const login = new URL("/login", AUTH_APP);
    login.searchParams.set("returnTo", "https://evil.example/");
    expect(isAllowedSignInLinkCallback(login.toString(), targets)).toBe(false);

    const doubled = new URL("/login", AUTH_APP);
    doubled.searchParams.append("returnTo", `${STOCKWATCHER}/`);
    doubled.searchParams.append("returnTo", "https://evil.example/");
    expect(isAllowedSignInLinkCallback(doubled.toString(), targets)).toBe(
      false,
    );
  });

  it("refuses parameters the login page would act on", () => {
    const invitation = new URL("/login", AUTH_APP);
    invitation.searchParams.set("token", "x");
    expect(isAllowedSignInLinkCallback(invitation.toString(), targets)).toBe(
      false,
    );
  });
});

describe("signInLinkLandingUrl", () => {
  it("keeps the destination of an auth app callback", () => {
    const landing = new URL(
      signInLinkLandingUrl(
        AUTH_APP,
        signInLinkCallback(AUTH_APP, `${STOCKWATCHER}/`),
        "challenge",
      ),
    );
    expect(landing.origin).toBe(AUTH_APP);
    expect(landing.pathname).toBe("/login");
    expect(landing.searchParams.get("returnTo")).toBe(`${STOCKWATCHER}/`);
    expect(landing.searchParams.get("signInLink")).toBe("challenge");
  });

  it("drops a destination that did not come from the auth app", () => {
    const landing = new URL(
      signInLinkLandingUrl(
        AUTH_APP,
        "https://cloud.denizlg24.com/?returnTo=x",
        "error",
      ),
    );
    expect(landing.searchParams.has("returnTo")).toBe(false);
    expect(landing.searchParams.get("signInLink")).toBe("error");
  });
});

describe("signInLinkEmail", () => {
  it("carries the link in both parts and says how long it lasts", () => {
    const email = signInLinkEmail({
      to: "mum@example.com",
      name: "Mum <3",
      url: "https://api.denizlg24.com/api/auth/magic-link/verify?token=a&b=1",
      sentByOwner: true,
    });
    expect(email.subject).toBe("Your sign-in link");
    expect(email.text).toContain(
      "Sign in: https://api.denizlg24.com/api/auth/magic-link/verify?token=a&b=1",
    );
    expect(email.text).toContain("15 minutes");
    expect(email.html).toContain("token=a&amp;b=1");
    expect(email.html).toContain("Mum &lt;3");
  });
});

describe("authMailerFromEnv", () => {
  it("needs only a Resend key, not Turnstile", () => {
    expect(authMailerFromEnv({ RESEND_API_KEY: "re_x" })).not.toBeNull();
  });

  it("is absent unless configured or explicitly in development", () => {
    expect(authMailerFromEnv({})).toBeNull();
    expect(authMailerFromEnv({ NODE_ENV: "development" })).toBeNull();
    expect(authMailerFromEnv({ AUTH_PUBLIC_ACCOUNTS_DEV: "1" })).not.toBeNull();
  });
});
