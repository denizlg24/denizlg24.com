import { describe, expect, it } from "bun:test";

import { defaultPasskeyName, isPasskeyDismissed } from "./passkey";

describe("isPasskeyDismissed", () => {
  it("hides a ceremony the browser ended", () => {
    expect(isPasskeyDismissed({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
    expect(
      isPasskeyDismissed({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }),
    ).toBe(true);
    expect(isPasskeyDismissed({ code: "AUTH_CANCELLED" })).toBe(true);
  });

  it("surfaces a server refusal", () => {
    expect(isPasskeyDismissed({ code: "AUTHENTICATION_FAILED" })).toBe(false);
    expect(isPasskeyDismissed({ code: "USER_VERIFICATION_REQUIRED" })).toBe(
      false,
    );
    expect(isPasskeyDismissed({})).toBe(false);
  });
});

describe("defaultPasskeyName", () => {
  it("names the platform, iPhone before Mac", () => {
    expect(
      defaultPasskeyName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("iPhone");
    expect(
      defaultPasskeyName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      ),
    ).toBe("Mac");
    expect(
      defaultPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    ).toBe("Windows");
    expect(defaultPasskeyName("curl/8")).toBe("Passkey");
  });
});
