import { afterEach, describe, expect, test } from "bun:test";
import {
  getEmailVerificationUrl,
  parseEmailChangeStep,
  verificationCallbackPath,
} from "./email-change";

const originalAuthUrl = process.env.MACROS_BETTER_AUTH_URL;

afterEach(() => {
  if (originalAuthUrl === undefined) {
    delete process.env.MACROS_BETTER_AUTH_URL;
  } else {
    process.env.MACROS_BETTER_AUTH_URL = originalAuthUrl;
  }
});

describe("verification links", () => {
  test("keeps the sign-up link the app already relies on", () => {
    process.env.MACROS_BETTER_AUTH_URL = "https://macros.example.com";

    expect(getEmailVerificationUrl("abc")).toBe(
      "https://macros.example.com/register/verify-email?token=abc&callbackURL=%2Fregister%2Fverified",
    );
  });

  test("names the email change step instead of a callback", () => {
    process.env.MACROS_BETTER_AUTH_URL = "https://macros.example.com";

    expect(getEmailVerificationUrl("abc", "confirmed")).toBe(
      "https://macros.example.com/register/verify-email?token=abc&change=confirmed",
    );
  });

  test("lands each step on the verified page", () => {
    expect(verificationCallbackPath(null)).toBe("/register/verified");
    expect(verificationCallbackPath("verified")).toBe(
      "/register/verified?change=verified",
    );
  });

  test("ignores unknown steps", () => {
    expect(parseEmailChangeStep("verified")).toBe("verified");
    expect(parseEmailChangeStep("https://evil.example")).toBeNull();
    expect(parseEmailChangeStep(undefined)).toBeNull();
  });
});
