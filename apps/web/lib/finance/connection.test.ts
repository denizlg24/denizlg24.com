import { describe, expect, test } from "bun:test";
import { financeAccountBindingKey } from "./core";

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
