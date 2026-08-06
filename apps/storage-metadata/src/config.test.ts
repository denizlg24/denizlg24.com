import { afterEach, describe, expect, it } from "bun:test";

import { configFromEnv } from "./config";

const KEYS = [
  "STORAGE_NAMESPACE_ROOT",
  "STORAGE_METADATA_SOCKET",
  "STORAGE_METADATA_TOKEN",
  "STORAGE_NAMESPACE_WITNESS_PATH_HOST",
  "STORAGE_NAMESPACE_WITNESS_VALUE",
] as const;

const valid: Record<(typeof KEYS)[number], string> = {
  STORAGE_METADATA_SOCKET: "/run/deniz-cloud/storage-metadata.sock",
  STORAGE_METADATA_TOKEN: "a-sufficiently-long-token",
  STORAGE_NAMESPACE_ROOT: "/srv/deniz-cloud/storage",
  STORAGE_NAMESPACE_WITNESS_PATH_HOST:
    "/srv/deniz-cloud/storage/.denizcloud-mount-witness",
  STORAGE_NAMESPACE_WITNESS_VALUE: "witness-value-abcdef123456",
};

function apply(overrides: Partial<Record<string, string | undefined>> = {}) {
  for (const key of KEYS) {
    const value = key in overrides ? overrides[key] : valid[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("metadata service configuration", () => {
  it("reads a complete configuration", () => {
    apply();
    expect(configFromEnv()).toEqual({
      branchPaths: [],
      branchRoots: null,
      namespaceRoot: valid.STORAGE_NAMESPACE_ROOT,
      watchMaxPending: 5_000,
      watchQuietMs: 400,
      smbScriptPath: null,
      socketGid: 1000,
      socketPath: valid.STORAGE_METADATA_SOCKET,
      token: valid.STORAGE_METADATA_TOKEN,
      witnessPath: valid.STORAGE_NAMESPACE_WITNESS_PATH_HOST,
      witnessValue: valid.STORAGE_NAMESPACE_WITNESS_VALUE,
    });
  });

  it("requires every value, including the witness", () => {
    // The witness is not optional: without it the service would happily serve
    // an unmounted namespace and report every entry as missing.
    for (const key of KEYS) {
      apply({ [key]: undefined });
      expect(() => configFromEnv(), `${key} should be required`).toThrow(key);
    }
  });

  it("rejects relative paths", () => {
    apply({ STORAGE_NAMESPACE_ROOT: "srv/deniz-cloud/storage" });
    expect(() => configFromEnv()).toThrow("absolute");
    apply({ STORAGE_METADATA_SOCKET: "run/metadata.sock" });
    expect(() => configFromEnv()).toThrow("absolute");
  });

  it("rejects a token short enough to guess", () => {
    apply({ STORAGE_METADATA_TOKEN: "short" });
    expect(() => configFromEnv()).toThrow("at least 16");
  });
});
