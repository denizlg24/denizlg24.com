import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StorageConfig } from "./config";
import { createStorageNamespace } from "./namespace";
import { PathValidationError } from "./path";
import { StorageService } from "./service";
import { PromotionQueue, type TieringRepository } from "./tiering";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

function config(
  namespace: StorageConfig["namespace"],
  root = "/private",
): StorageConfig {
  return {
    namespace,
    ssdStoragePath: `${root}/ssd`,
    hddStoragePath: `${root}/hdd`,
    tempUploadPath: `${root}/internal/tus`,
    shareLinkSecret: "secret",
    archiveMaxBytes: 1024 * 1024,
    archivePath: `${root}/internal/archives`,
    archiveTtlMs: 60_000,
    s3: {
      rootPath: `${root}/internal/s3`,
      tempPath: `${root}/internal/s3-temp`,
      region: "eu-west-1",
      credentialEncryptionKey: "x".repeat(32),
      credentialCacheTtlMs: 30_000,
    },
    tiering: {
      highWatermarkPercent: 80,
      targetWatermarkPercent: 70,
      minAgeMs: 0,
      minSizeBytes: 0,
      batchCap: 20,
      placementLookahead: 500,
      migrationMode: false,
      restoreActive: false,
    },
  };
}

describe("StorageNamespace", () => {
  it("keeps legacy logical SSD paths and UUID-addressed HDD paths", () => {
    const namespace = createStorageNamespace(
      config({ mode: "legacy-dual-path", rootPath: null }),
    );

    expect(namespace.resolveFolderPath("/owner/reports")).toBe(
      "/private/ssd/owner/reports",
    );
    expect(
      namespace.resolveNewFilePath(
        "/owner/reports/file.txt",
        "hdd",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toBe("/private/hdd/20000000-0000-4000-8000-000000000002");
    expect(
      namespace.resolveFilePath({
        id: "20000000-0000-4000-8000-000000000002",
        path: "/owner/reports/file.txt",
        tier: "hdd",
        diskPath: "/private/hdd/legacy-id",
      }),
    ).toBe("/private/hdd/legacy-id");
  });

  it("routes personal and shared entries through one broker root", () => {
    const namespace = createStorageNamespace(
      config({
        metadata: null,
        mode: "broker-mounted",
        rootPath: "/srv/deniz-cloud/storage",
        witnessPath: "/srv/deniz-cloud/storage/.denizcloud-mount-witness",
        witnessValue: "test-witness",
      }),
    );

    expect(namespace.resolveFolderPath("/shared/reports")).toBe(
      "/srv/deniz-cloud/storage/shared/reports",
    );
    expect(
      namespace.resolveNewFilePath(
        "/owner/report.pdf",
        "hdd",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toBe("/srv/deniz-cloud/storage/owner/report.pdf");
    expect(
      namespace.resolveFilePath({
        id: "20000000-0000-4000-8000-000000000002",
        path: "/owner/report.pdf",
        tier: "hdd",
        diskPath: "/private/hdd/legacy-id",
      }),
    ).toBe("/srv/deniz-cloud/storage/owner/report.pdf");
    expect(namespace.capabilities.protectedXattrs).toBe(false);
    expect(namespace.capabilities.authoritativePhysicalTier).toBe(false);
  });

  it("rejects traversal before resolving either layout", () => {
    const broker = createStorageNamespace(
      config({
        metadata: null,
        mode: "broker-mounted",
        rootPath: "/srv/deniz-cloud/storage",
        witnessPath: "/srv/deniz-cloud/storage/.denizcloud-mount-witness",
        witnessValue: "test-witness",
      }),
    );
    const legacy = createStorageNamespace(
      config({ mode: "legacy-dual-path", rootPath: null }),
    );

    expect(() => broker.resolveFolderPath("/safe/../escape")).toThrow(
      PathValidationError,
    );
    expect(() => legacy.resolveNewFilePath("//escape", "ssd", "id")).toThrow(
      PathValidationError,
    );
    expect(() =>
      broker.resolveFolderPath("/.denizcloud-mount-witness"),
    ).toThrow("Broker mount witness is outside the user namespace");
  });

  it("fails broker startup for a missing root or symlink", async () => {
    const parent = await mkdtemp(join(tmpdir(), "storage-namespace-"));
    temporaryRoots.push(parent);
    const missing = createStorageNamespace(
      config({
        metadata: null,
        mode: "broker-mounted",
        rootPath: join(parent, "missing"),
        witnessPath: join(parent, "missing", ".denizcloud-mount-witness"),
        witnessValue: "test-witness",
      }),
    );
    await expect(missing.initialize()).rejects.toThrow(
      "Broker-mounted storage namespace is unavailable",
    );

    const target = join(parent, "target");
    const targetNamespace = createStorageNamespace(
      config({ mode: "legacy-dual-path", rootPath: null }, target),
    );
    await targetNamespace.initialize();
    const link = join(parent, "link");
    await symlink(join(target, "ssd"), link);
    const linked = createStorageNamespace(
      config({
        metadata: null,
        mode: "broker-mounted",
        rootPath: link,
        witnessPath: join(link, ".denizcloud-mount-witness"),
        witnessValue: "test-witness",
      }),
    );
    await expect(linked.initialize()).rejects.toThrow(
      "must be an existing non-symlink directory",
    );
  });

  it("fails closed when legacy promotion tiering is enabled", () => {
    const brokerConfig = config({
      metadata: null,
      mode: "broker-mounted",
      rootPath: "/srv/deniz-cloud/storage",
      witnessPath: "/srv/deniz-cloud/storage/.denizcloud-mount-witness",
      witnessValue: "test-witness",
    });
    const repository: TieringRepository = {
      listFiles: async () => [],
      findFile: async () => null,
      swapLocation: async () => false,
      deleteFile: async () => false,
    };
    const options = {
      ssdStoragePath: brokerConfig.ssdStoragePath,
      hddStoragePath: brokerConfig.hddStoragePath,
    };

    expect(
      () =>
        new StorageService(
          {} as never,
          {} as never,
          brokerConfig,
          new PromotionQueue(repository, options),
        ),
    ).toThrow(
      "Broker-mounted storage requires legacy promotion tiering to be disabled",
    );
    expect(
      () =>
        new StorageService(
          {} as never,
          {} as never,
          brokerConfig,
          new PromotionQueue(repository, options, false),
        ),
    ).not.toThrow();
  });

  it("requires the expected mount witness before broker writes can start", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-broker-"));
    temporaryRoots.push(root);
    const witnessPath = join(root, ".denizcloud-mount-witness");
    const namespaceConfig = {
      metadata: null,
      mode: "broker-mounted" as const,
      rootPath: root,
      witnessPath,
      witnessValue: "expected-witness",
    };
    const missing = createStorageNamespace(config(namespaceConfig));

    await expect(missing.initialize()).rejects.toThrow(
      "Broker-mounted storage witness is unavailable",
    );

    await Bun.write(witnessPath, "wrong-witness\n");
    const wrong = createStorageNamespace(config(namespaceConfig));
    await expect(wrong.initialize()).rejects.toThrow(
      "storage witness value does not match",
    );

    await Bun.write(witnessPath, "expected-witness\n");
    const valid = createStorageNamespace(config(namespaceConfig));
    await expect(valid.initialize()).resolves.toBeUndefined();
  });
});
