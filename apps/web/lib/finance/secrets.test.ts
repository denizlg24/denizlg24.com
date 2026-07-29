import { afterEach, describe, expect, test } from "bun:test";
import { decryptFinanceSecret, encryptFinanceSecret } from "./secrets";

afterEach(() => {
  delete process.env.FINANCE_ENCRYPTION_KEY;
});

describe("finance secret storage", () => {
  test("encrypts provider session references at rest", () => {
    process.env.FINANCE_ENCRYPTION_KEY = "ab".repeat(32);
    const encrypted = encryptFinanceSecret("session-reference");
    expect(encrypted.ciphertext).not.toContain("session-reference");
    expect(decryptFinanceSecret(encrypted)).toBe("session-reference");
  });

  test("refuses missing or malformed keys", () => {
    // Bun auto-loads .env, so an ambient key would otherwise turn this into a
    // false positive by exercising the valid-key path instead.
    delete process.env.FINANCE_ENCRYPTION_KEY;
    expect(() => encryptFinanceSecret("secret")).toThrow();
    process.env.FINANCE_ENCRYPTION_KEY = "short";
    expect(() => encryptFinanceSecret("secret")).toThrow();
  });
});
