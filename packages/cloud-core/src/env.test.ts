import { afterEach, describe, expect, it } from "bun:test";

import { optionalEnv, requiredEnv } from "./env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("environment helpers", () => {
  it("returns required variables unchanged", () => {
    process.env.CLOUD_CORE_REQUIRED = "  value=with spaces  ";
    expect(requiredEnv("CLOUD_CORE_REQUIRED")).toBe("  value=with spaces  ");
  });

  it("rejects missing and empty required variables", () => {
    delete process.env.CLOUD_CORE_MISSING;
    expect(() => requiredEnv("CLOUD_CORE_MISSING")).toThrow(
      "Missing required environment variable: CLOUD_CORE_MISSING",
    );

    process.env.CLOUD_CORE_MISSING = "";
    expect(() => requiredEnv("CLOUD_CORE_MISSING")).toThrow();
  });

  it("uses a default only for an absent optional variable", () => {
    delete process.env.CLOUD_CORE_OPTIONAL;
    expect(optionalEnv("CLOUD_CORE_OPTIONAL", "fallback")).toBe("fallback");

    process.env.CLOUD_CORE_OPTIONAL = "";
    expect(optionalEnv("CLOUD_CORE_OPTIONAL", "fallback")).toBe("");
  });
});
