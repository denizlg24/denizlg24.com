import { join } from "node:path";

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
  ssdStoragePath: string;
  hddStoragePath: string;
  tempUploadPath: string;
  shareLinkSecret: string;
  archiveMaxBytes: number;
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

export function storageConfigFromEnv(): StorageConfig {
  const ssdStoragePath = requiredEnv("SSD_STORAGE_PATH");
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

  return {
    ssdStoragePath,
    hddStoragePath: requiredEnv("HDD_STORAGE_PATH"),
    tempUploadPath:
      process.env.TEMP_UPLOAD_PATH ?? join(ssdStoragePath, ".tus-partial"),
    // Existing links use JWT_SECRET. Keeping this name is part of the
    // cutover wire contract even though human authentication moved away from JWT.
    shareLinkSecret: requiredEnv("JWT_SECRET"),
    archiveMaxBytes: boundedInteger(
      "STORAGE_ARCHIVE_MAX_BYTES",
      2 * GIBIBYTE,
      MEBIBYTE,
      4 * GIBIBYTE - MEBIBYTE,
    ),
    s3: {
      rootPath: process.env.S3_ROOT_PATH ?? join(ssdStoragePath, ".s3-v2"),
      tempPath: process.env.S3_TEMP_PATH ?? join(ssdStoragePath, ".s3-v2-temp"),
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
