import { describe, expect, test } from "bun:test";
import { bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  test("matches the platform encoder at every padding length", () => {
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const bytes = new TextEncoder().encode(text);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
    const binary = new Uint8Array(256).map((_, index) => index);
    expect(bytesToBase64(binary)).toBe(Buffer.from(binary).toString("base64"));
  });
});
