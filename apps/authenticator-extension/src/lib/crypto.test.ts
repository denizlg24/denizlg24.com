import { describe, expect, test } from "bun:test";
import {
  decryptJson,
  deriveKey,
  encryptJson,
  exportKey,
  fromBase64,
  importKey,
  newSalt,
  PBKDF2_ITERATIONS,
  toBase64,
} from "./crypto";

/** The shipped count is deliberately slow; these tests only need the shape. */
const TEST_ITERATIONS = 1_000;

describe("base64", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("vault encryption", () => {
  test("round-trips a payload", async () => {
    const salt = newSalt();
    const key = await deriveKey("correct horse", salt, TEST_ITERATIONS);
    const blob = await encryptJson(key, { secret: "GEZDGNBV", count: 2 });

    expect(blob.ciphertext).not.toContain("GEZDGNBV");
    expect(
      await decryptJson<{ secret: string; count: number }>(key, blob),
    ).toEqual({ secret: "GEZDGNBV", count: 2 });
  });

  test("a wrong passphrase fails authentication rather than returning garbage", async () => {
    const salt = newSalt();
    const key = await deriveKey("correct horse", salt, TEST_ITERATIONS);
    const blob = await encryptJson(key, { secret: "GEZDGNBV" });

    const wrong = await deriveKey("wrong horse", salt, TEST_ITERATIONS);
    expect(decryptJson(wrong, blob)).rejects.toThrow();
  });

  test("a different salt derives a different key", async () => {
    const first = await deriveKey(
      "same passphrase",
      newSalt(),
      TEST_ITERATIONS,
    );
    const second = await deriveKey(
      "same passphrase",
      newSalt(),
      TEST_ITERATIONS,
    );

    expect(await exportKey(first)).not.toBe(await exportKey(second));
  });

  test("uses a fresh IV per encryption", async () => {
    const key = await deriveKey("passphrase", newSalt(), TEST_ITERATIONS);
    const first = await encryptJson(key, { value: 1 });
    const second = await encryptJson(key, { value: 1 });

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  test("survives the export/import the session store puts it through", async () => {
    const key = await deriveKey("passphrase", newSalt(), TEST_ITERATIONS);
    const blob = await encryptJson(key, { value: "kept" });

    const restored = await importKey(await exportKey(key));
    expect(await decryptJson<{ value: string }>(restored, blob)).toEqual({
      value: "kept",
    });
  });

  test("ships the OWASP iteration count", () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });
});
