import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { storageConfigFromEnv } from "./config";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    HDD_STORAGE_PATH: "/private/hdd/namespace",
    JWT_SECRET: "share-secret",
    S3_CREDENTIAL_ENCRYPTION_KEY: "x".repeat(32),
    SSD_STORAGE_PATH: "/private/ssd/namespace",
  };
  delete process.env.STORAGE_NAMESPACE_MODE;
  delete process.env.STORAGE_NAMESPACE_PATH;
  delete process.env.STORAGE_NAMESPACE_WITNESS_PATH;
  delete process.env.STORAGE_NAMESPACE_WITNESS_VALUE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("storage namespace configuration", () => {
  it("retains the legacy dual-path layout by default", () => {
    const config = storageConfigFromEnv();

    expect(config.namespace).toEqual({
      mode: "legacy-dual-path",
      rootPath: null,
    });
    expect(config.ssdStoragePath).toBe("/private/ssd/namespace");
    expect(config.hddStoragePath).toBe("/private/hdd/namespace");
  });

  it("retains relative paths in legacy contract-test mode", () => {
    process.env.SSD_STORAGE_PATH = "fixtures/ssd";
    process.env.HDD_STORAGE_PATH = "fixtures/hdd";

    const config = storageConfigFromEnv();

    expect(config.ssdStoragePath).toBe("fixtures/ssd");
    expect(config.hddStoragePath).toBe("fixtures/hdd");
  });

  it("accepts Compose's empty broker variables in legacy mode", () => {
    process.env.STORAGE_NAMESPACE_PATH = "";
    process.env.STORAGE_NAMESPACE_WITNESS_PATH = "";
    process.env.STORAGE_NAMESPACE_WITNESS_VALUE = "";

    expect(storageConfigFromEnv().namespace).toEqual({
      mode: "legacy-dual-path",
      rootPath: null,
    });
  });

  it("selects one broker-mounted request namespace without moving internals", () => {
    process.env.STORAGE_NAMESPACE_MODE = "broker-mounted";
    process.env.STORAGE_NAMESPACE_PATH = "/srv/deniz-cloud/storage";
    process.env.STORAGE_NAMESPACE_WITNESS_PATH =
      "/srv/deniz-cloud/storage/.denizcloud-mount-witness";
    process.env.STORAGE_NAMESPACE_WITNESS_VALUE = "production-witness";

    const config = storageConfigFromEnv();

    expect(config.namespace).toEqual({
      mode: "broker-mounted",
      rootPath: "/srv/deniz-cloud/storage",
      witnessPath: "/srv/deniz-cloud/storage/.denizcloud-mount-witness",
      witnessValue: "production-witness",
    });
    expect(config.tempUploadPath).toBe("/private/ssd/namespace/.tus-partial");
    expect(config.archivePath).toBe("/private/ssd/namespace/.archives");
    expect(config.s3.rootPath).toBe("/private/ssd/namespace/.s3-v2");
    expect(config.s3.tempPath).toBe("/private/ssd/namespace/.s3-v2-temp");
  });

  it("rejects ambiguous modes and namespace paths", () => {
    process.env.STORAGE_NAMESPACE_MODE = "automatic";
    expect(() => storageConfigFromEnv()).toThrow(
      "STORAGE_NAMESPACE_MODE must be legacy-dual-path or broker-mounted",
    );

    process.env.STORAGE_NAMESPACE_MODE = "broker-mounted";
    delete process.env.STORAGE_NAMESPACE_PATH;
    expect(() => storageConfigFromEnv()).toThrow(
      "Missing required environment variable: STORAGE_NAMESPACE_PATH",
    );

    process.env.STORAGE_NAMESPACE_MODE = "legacy-dual-path";
    process.env.STORAGE_NAMESPACE_PATH = "/srv/deniz-cloud/storage";
    expect(() => storageConfigFromEnv()).toThrow(
      "STORAGE_NAMESPACE_PATH is valid only",
    );
  });

  it("rejects a broker namespace that overlaps branches or S3", () => {
    process.env.STORAGE_NAMESPACE_MODE = "broker-mounted";
    process.env.STORAGE_NAMESPACE_PATH = "/private/ssd/namespace/users";
    process.env.STORAGE_NAMESPACE_WITNESS_PATH =
      "/private/ssd/namespace/users/.denizcloud-mount-witness";
    process.env.STORAGE_NAMESPACE_WITNESS_VALUE = "production-witness";
    expect(() => storageConfigFromEnv()).toThrow(
      "STORAGE_NAMESPACE_PATH must not overlap SSD_STORAGE_PATH",
    );

    process.env.STORAGE_NAMESPACE_PATH = "/srv/deniz-cloud/storage";
    process.env.STORAGE_NAMESPACE_WITNESS_PATH =
      "/srv/deniz-cloud/storage/.denizcloud-mount-witness";
    process.env.S3_ROOT_PATH = "/srv/deniz-cloud/storage/.s3-v2";
    expect(() => storageConfigFromEnv()).toThrow(
      "STORAGE_NAMESPACE_PATH must not overlap S3_ROOT_PATH",
    );
  });

  it("requires the mount witness to be inside the broker root", () => {
    process.env.STORAGE_NAMESPACE_MODE = "broker-mounted";
    process.env.STORAGE_NAMESPACE_PATH = "/srv/deniz-cloud/storage";
    process.env.STORAGE_NAMESPACE_WITNESS_VALUE = "production-witness";

    delete process.env.STORAGE_NAMESPACE_WITNESS_PATH;
    expect(() => storageConfigFromEnv()).toThrow(
      "Missing required environment variable: STORAGE_NAMESPACE_WITNESS_PATH",
    );

    process.env.STORAGE_NAMESPACE_WITNESS_PATH =
      "/srv/deniz-cloud/internal/witness";
    expect(() => storageConfigFromEnv()).toThrow(
      "must be .denizcloud-mount-witness directly inside STORAGE_NAMESPACE_PATH",
    );
  });
});
