import { afterEach, describe, expect, test } from "bun:test";
import { createAuthEmail, getPublicAppOrigin, getPublicAppUrl } from "./email";

const originalAuthUrl = process.env.MACROS_BETTER_AUTH_URL;

afterEach(() => {
  if (originalAuthUrl === undefined) {
    delete process.env.MACROS_BETTER_AUTH_URL;
  } else {
    process.env.MACROS_BETTER_AUTH_URL = originalAuthUrl;
  }
});

describe("auth email URLs", () => {
  test("uses the configured public app origin", () => {
    process.env.MACROS_BETTER_AUTH_URL = "https://macros.example.com/";

    expect(getPublicAppOrigin()).toBe("https://macros.example.com");
    expect(
      getPublicAppUrl("http://0.0.0.0:3000/api/auth/reset?token=secret"),
    ).toBe("https://macros.example.com/api/auth/reset?token=secret");
  });

  test("renders a branded HTML email and plain-text fallback", () => {
    const email = createAuthEmail({
      actionLabel: "Verify email",
      actionUrl: "https://macros.example.com/verify?token=a&b=c",
      body: "Confirm your account.",
      preheader: "Confirm your email.",
      title: "Verify your email",
    });

    expect(email.html).toContain("Macros");
    expect(email.html).toContain("Verify your email");
    expect(email.html).toContain("token=a&amp;b=c");
    expect(email.text).toContain(
      "Verify email: https://macros.example.com/verify?token=a&b=c",
    );
  });
});
