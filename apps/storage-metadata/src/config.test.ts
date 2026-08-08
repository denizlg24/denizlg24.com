import { afterEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";

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

const BRANCH_KEYS = [
  "STORAGE_SSD_BRANCH_PATH",
  "STORAGE_HDD_BRANCH_PATH",
] as const;

function applyBranches(ssd: string | undefined, hdd: string | undefined) {
  if (ssd === undefined) delete process.env.STORAGE_SSD_BRANCH_PATH;
  else process.env.STORAGE_SSD_BRANCH_PATH = ssd;
  if (hdd === undefined) delete process.env.STORAGE_HDD_BRANCH_PATH;
  else process.env.STORAGE_HDD_BRANCH_PATH = hdd;
}

afterEach(() => {
  for (const key of [...KEYS, ...BRANCH_KEYS, "STORAGE_BRANCH_PATHS"]) {
    delete process.env[key];
  }
});

describe("metadata service configuration", () => {
  it("reads a complete configuration", () => {
    apply();
    expect(configFromEnv()).toEqual({
      branchPaths: [],
      branchRoots: null,
      // Resolved, so `contains` compares like with like against the branch
      // paths it guards.
      namespaceRoot: resolve(valid.STORAGE_NAMESPACE_ROOT),
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

describe("branch role configuration", () => {
  it("reads a valid pair, normalising trailing slashes", () => {
    apply();
    applyBranches(
      "/mnt/ssd/deniz-cloud/namespace/",
      "/mnt/hdd/deniz-cloud/namespace",
    );
    // Resolved, not spelled out: the separator is the platform's, the
    // normalisation of the trailing slash is the assertion.
    expect(configFromEnv().branchRoots).toEqual({
      hdd: resolve("/mnt/hdd/deniz-cloud/namespace"),
      ssd: resolve("/mnt/ssd/deniz-cloud/namespace"),
    });
  });

  it("requires both roles or neither", () => {
    apply();
    applyBranches("/mnt/ssd/namespace", undefined);
    expect(() => configFromEnv()).toThrow("must be set together");
    applyBranches(undefined, "/mnt/hdd/namespace");
    expect(() => configFromEnv()).toThrow("must be set together");
  });

  it("rejects relative role paths", () => {
    apply();
    applyBranches("mnt/ssd/namespace", "/mnt/hdd/namespace");
    expect(() => configFromEnv()).toThrow("absolute");
  });

  it("rejects a role inside the namespace root", () => {
    // The union mount reading itself: every tier move would copy a file onto
    // itself through FUSE.
    apply();
    applyBranches(`${valid.STORAGE_NAMESPACE_ROOT}/ssd`, "/mnt/hdd/namespace");
    expect(() => configFromEnv()).toThrow("outside the namespace root");
    applyBranches("/mnt/ssd/namespace", valid.STORAGE_NAMESPACE_ROOT);
    expect(() => configFromEnv()).toThrow("outside the namespace root");
  });

  // The namespace root used to be compared raw against resolved branch paths.
  // A trailing slash or a `/./` in the deployed value therefore made the
  // containment check silently pass, admitting exactly the layout the previous
  // test rejects.
  it("still rejects a nested role when the namespace root is not normalised", () => {
    apply({ STORAGE_NAMESPACE_ROOT: `${valid.STORAGE_NAMESPACE_ROOT}/` });
    applyBranches(`${valid.STORAGE_NAMESPACE_ROOT}/ssd`, "/mnt/hdd/namespace");
    expect(() => configFromEnv()).toThrow("outside the namespace root");

    apply({
      STORAGE_NAMESPACE_ROOT: valid.STORAGE_NAMESPACE_ROOT.replace(
        "/storage",
        "/./storage",
      ),
    });
    applyBranches(`${valid.STORAGE_NAMESPACE_ROOT}/ssd`, "/mnt/hdd/namespace");
    expect(() => configFromEnv()).toThrow("outside the namespace root");
  });

  it("rejects a STORAGE_BRANCH_PATHS entry inside an unnormalised root", () => {
    apply({ STORAGE_NAMESPACE_ROOT: `${valid.STORAGE_NAMESPACE_ROOT}/` });
    process.env.STORAGE_BRANCH_PATHS = `${valid.STORAGE_NAMESPACE_ROOT}/ssd`;
    expect(() => configFromEnv()).toThrow("outside the namespace root");
  });

  it("rejects roles that are the same directory or nest", () => {
    apply();
    applyBranches("/mnt/disks/ssd", "/mnt/disks/ssd");
    expect(() => configFromEnv()).toThrow("must not nest");
    // `/mnt/ssd/` and `/mnt/ssd` are the same directory.
    applyBranches("/mnt/disks/ssd/", "/mnt/disks/ssd");
    expect(() => configFromEnv()).toThrow("must not nest");
    // The dangerous one: the HDD branch sitting inside the SSD branch makes an
    // unmounted SSD read as non-empty, so `branchesMounted` says yes and the
    // pass migrates the namespace onto one disk.
    applyBranches("/mnt/disks", "/mnt/disks/hdd");
    expect(() => configFromEnv()).toThrow("must not nest");
    applyBranches("/mnt/disks/ssd", "/mnt/disks");
    expect(() => configFromEnv()).toThrow("must not nest");
  });

  it("allows sibling roots under a shared parent", () => {
    apply();
    applyBranches("/mnt/disks/ssd", "/mnt/disks/hdd");
    expect(configFromEnv().branchRoots).toEqual({
      hdd: resolve("/mnt/disks/hdd"),
      ssd: resolve("/mnt/disks/ssd"),
    });
  });
});
