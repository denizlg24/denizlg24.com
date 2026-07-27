import { describe, expect, it } from "bun:test";
import type { EnvoyStorageEnv } from "./env";
import {
  blobKey,
  commitKey,
  getLegacyR2Config,
  getS3ClientOptions,
  manifestKey,
} from "./storage";

const CONFIG = {
  ENVOY_S3_ENDPOINT: "https://storage.denizlg24.com/v2/",
  ENVOY_S3_REGION: "eu-west-1",
  ENVOY_S3_ACCESS_KEY_ID: "project-access",
  ENVOY_S3_SECRET_ACCESS_KEY: "project-secret",
  ENVOY_S3_BUCKET: "envoy",
} satisfies EnvoyStorageEnv;

describe("Envoy S3 storage adapter", () => {
  it("uses the monorepo gateway with path-style addressing", () => {
    expect(getS3ClientOptions(CONFIG)).toEqual({
      endpoint: "https://storage.denizlg24.com/v2",
      region: "eu-west-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "project-access",
        secretAccessKey: "project-secret",
      },
    });
  });

  it("keeps legacy R2 fallback explicit and all-or-nothing", () => {
    expect(getLegacyR2Config(CONFIG)).toBeNull();
    expect(
      getLegacyR2Config({
        ...CONFIG,
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "legacy-access",
        R2_SECRET_ACCESS_KEY: "legacy-secret",
        R2_BUCKET: "legacy-bucket",
      }),
    ).toEqual({
      bucket: "legacy-bucket",
      clientOptions: {
        region: "auto",
        endpoint: "https://account.r2.cloudflarestorage.com",
        credentials: {
          accessKeyId: "legacy-access",
          secretAccessKey: "legacy-secret",
        },
      },
    });
    expect(() =>
      getLegacyR2Config({ ...CONFIG, R2_ACCOUNT_ID: "partial" }),
    ).toThrow("must be configured together");
  });

  it("keeps existing object-key layouts stable", () => {
    const owner = "f9235b72-8525-48aa-a3f8-a519eecb6be0";
    const project = "5211d914-5dd3-49e7-b388-488c06f8120c";
    const hash = "a".repeat(64);

    expect(blobKey(owner, project, hash)).toBe(
      `${owner}/${project}/blobs/${hash}.blob`,
    );
    expect(manifestKey(owner, project, hash)).toBe(
      `${owner}/${project}/manifests/${hash}.enc`,
    );
    expect(commitKey(owner, project, hash)).toBe(
      `${owner}/${project}/commits/${hash}.enc`,
    );
  });
});
