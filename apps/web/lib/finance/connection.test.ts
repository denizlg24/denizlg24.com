import { describe, expect, test } from "bun:test";
import { financeAccountBindingKey } from "./core";
import { financeLinkRedirectUrl } from "./link-config";

describe("finance account callback", () => {
  test("always uses the production callback registered with Enable Banking", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(financeLinkRedirectUrl()).toBe(
      "https://denizlg24.com/api/admin/finance/callback",
    );
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});

describe("finance account relinking", () => {
  test("binds a new session and account uid to the existing stable account", () => {
    const before = {
      accountRef: "old-account-uid",
      providerSessionRef: "old-session",
      identificationHash: "stable-identification-hash",
    };
    const after = {
      accountRef: "new-account-uid",
      providerSessionRef: "new-session",
      identificationHash: "stable-identification-hash",
    };

    expect(financeAccountBindingKey(after)).toBe(
      financeAccountBindingKey(before),
    );
  });
});
