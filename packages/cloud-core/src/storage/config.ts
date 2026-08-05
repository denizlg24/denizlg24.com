import { isAbsolute, join, relative, resolve } from "node:path";

import { requiredEnv } from "../env";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

function boundedNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = boundedNumber(name, fallback, minimum, maximum);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

export interface StorageConfig {
  namespace: StorageNamespaceConfig;
  ssdStoragePath: string;
  hddStoragePath: string;
  tempUploadPath: string;
  shareLinkSecret: string;
  archiveMaxBytes: number;
  archivePath: string;
  archiveTtlMs: number;
  s3: {
    rootPath: string;
    tempPath: string;
    region: string;
    credentialEncryptionKey: string;
    credentialCacheTtlMs: number;
  };
  tiering: {
    highWatermarkPercent: number;
    targetWatermarkPercent: number;
    minAgeMs: number;
    minSizeBytes: number;
    batchCap: number;
  };
}

export type StorageNamespaceMode = "legacy-dual-path" | "broker-mounted";
export const BROKER_NAMESPACE_WITNESS_NAME = ".denizcloud-mount-witness";

export type StorageNamespaceConfig =
  | {
      mode: "legacy-dual-path";
      rootPath: null;
    }
  | {
      mode: "broker-mounted";
      rootPath: string;
      witnessPath: string;
      witnessValue: string;
    };

function normalizedAbsolutePath(name: string, value: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return resolve(value);
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return (
    fromLeft === "" ||
    (!fromLeft.startsWith("..") && !isAbsolute(fromLeft)) ||
    (!fromRight.startsWith("..") && !isAbsolute(fromRight))
  );
}

function namespaceConfigFromEnv(
  independentPaths: Record<string, string>,
): StorageNamespaceConfig {
  const rawMode = process.env.STORAGE_NAMESPACE_MODE ?? "legacy-dual-path";
  if (rawMode === "legacy-dual-path") {
    if (process.env.STORAGE_NAMESPACE_PATH?.trim()) {
      throw new Error(
        "STORAGE_NAMESPACE_PATH is valid only when STORAGE_NAMESPACE_MODE=broker-mounted",
      );
    }
    return { mode: rawMode, rootPath: null };
  }
  if (rawMode !== "broker-mounted") {
    throw new Error(
      "STORAGE_NAMESPACE_MODE must be legacy-dual-path or broker-mounted",
    );
  }

  const rootPath = normalizedAbsolutePath(
    "STORAGE_NAMESPACE_PATH",
    requiredEnv("STORAGE_NAMESPACE_PATH"),
  );
  const witnessPath = normalizedAbsolutePath(
    "STORAGE_NAMESPACE_WITNESS_PATH",
    requiredEnv("STORAGE_NAMESPACE_WITNESS_PATH"),
  );
  if (witnessPath !== join(rootPath, BROKER_NAMESPACE_WITNESS_NAME)) {
    throw new Error(
      `STORAGE_NAMESPACE_WITNESS_PATH must be ${BROKER_NAMESPACE_WITNESS_NAME} directly inside STORAGE_NAMESPACE_PATH`,
    );
  }
  const witnessRelativePath = relative(rootPath, witnessPath);
  if (
    witnessRelativePath === "" ||
    witnessRelativePath.startsWith("..") ||
    isAbsolute(witnessRelativePath)
  ) {
    throw new Error(
      "STORAGE_NAMESPACE_WITNESS_PATH must be a file inside STORAGE_NAMESPACE_PATH",
    );
  }
  const witnessValue = requiredEnv("STORAGE_NAMESPACE_WITNESS_VALUE");
  if (witnessValue.includes("\n") || witnessValue.includes("\r")) {
    throw new Error("STORAGE_NAMESPACE_WITNESS_VALUE must be one line");
  }
  for (const [name, path] of Object.entries(independentPaths)) {
    if (!isAbsolute(path)) {
      throw new Error(
        `${name} must be an absolute path in broker-mounted mode`,
      );
    }
    if (pathsOverlap(rootPath, resolve(path))) {
      throw new Error(
        `STORAGE_NAMESPACE_PATH must not overlap ${name}; user-visible storage and internal/tiering paths must remain independent`,
      );
    }
  }
  return { mode: rawMode, rootPath, witnessPath, witnessValue };
}

export function storageConfigFromEnv(): StorageConfig {
  // Legacy mode deliberately retains the previous path contract, including
  // relative paths used by isolated contract tests. Broker mode validates all
  // paths as absolute below before it can start.
  const ssdStoragePath = requiredEnv("SSD_STORAGE_PATH");
  const hddStoragePath = requiredEnv("HDD_STORAGE_PATH");
  const credentialEncryptionKey = requiredEnv("S3_CREDENTIAL_ENCRYPTION_KEY");
  if (credentialEncryptionKey.length < 32) {
    throw new Error(
      "S3_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters",
    );
  }
  const highWatermarkPercent = boundedNumber(
    "SSD_HIGH_WATERMARK_PERCENT",
    80,
    1,
    99,
  );
  const targetWatermarkPercent = boundedNumber(
    "SSD_TARGET_WATERMARK_PERCENT",
    70,
    0,
    98,
  );
  if (targetWatermarkPercent >= highWatermarkPercent) {
    throw new Error(
      "SSD_TARGET_WATERMARK_PERCENT must be lower than SSD_HIGH_WATERMARK_PERCENT",
    );
  }

  const tempUploadPath =
    process.env.TEMP_UPLOAD_PATH ?? join(ssdStoragePath, ".tus-partial");
  const archivePath =
    process.env.STORAGE_ARCHIVE_PATH ?? join(ssdStoragePath, ".archives");
  const s3RootPath = process.env.S3_ROOT_PATH ?? join(ssdStoragePath, ".s3-v2");
  const s3TempPath =
    process.env.S3_TEMP_PATH ?? join(ssdStoragePath, ".s3-v2-temp");
  const namespace = namespaceConfigFromEnv({
    SSD_STORAGE_PATH: ssdStoragePath,
    HDD_STORAGE_PATH: hddStoragePath,
    TEMP_UPLOAD_PATH: tempUploadPath,
    STORAGE_ARCHIVE_PATH: archivePath,
    S3_ROOT_PATH: s3RootPath,
    S3_TEMP_PATH: s3TempPath,
  });

  return {
    namespace,
    ssdStoragePath,
    hddStoragePath,
    tempUploadPath,
    // Existing links use JWT_SECRET. Keeping this name is part of the
    // cutover wire contract even though human authentication moved away from JWT.
    shareLinkSecret: requiredEnv("JWT_SECRET"),
    archiveMaxBytes: boundedInteger(
      "STORAGE_ARCHIVE_MAX_BYTES",
      2 * GIBIBYTE,
      MEBIBYTE,
      4 * GIBIBYTE - MEBIBYTE,
    ),
    archivePath,
    archiveTtlMs:
      boundedInteger("STORAGE_ARCHIVE_TTL_MINUTES", 30, 1, 1_440) * 60 * 1_000,
    s3: {
      rootPath: s3RootPath,
      tempPath: s3TempPath,
      region: process.env.S3_REGION ?? "eu-west-1",
      credentialEncryptionKey,
      credentialCacheTtlMs: boundedInteger(
        "S3_CREDENTIAL_CACHE_TTL_MS",
        30_000,
        1_000,
        300_000,
      ),
    },
    tiering: {
      highWatermarkPercent,
      targetWatermarkPercent,
      minAgeMs:
        boundedInteger("STORAGE_TIER_MIN_AGE_DAYS", 30, 0, 3_650) *
        24 *
        60 *
        60 *
        1_000,
      minSizeBytes:
        boundedInteger("STORAGE_TIER_MIN_SIZE_MIB", 500, 0, 1_048_576) *
        MEBIBYTE,
      batchCap: boundedInteger("STORAGE_TIER_BATCH_CAP", 20, 1, 10_000),
    },
  };
}
