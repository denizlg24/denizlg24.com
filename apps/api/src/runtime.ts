import {
  createDb,
  createMeiliClient,
  createTieringRepository,
  ensureLegacyS3Credential,
  ensureStorageSearchIndex,
  initializeS3,
  PromotionQueue,
  requiredEnv,
  S3CredentialResolver,
  StorageService,
  storageConfigFromEnv,
} from "@repo/cloud-core";
import { createClient } from "redis";

import { createCloudApiApp } from "./app";
import {
  CLOUD_AUTH_TRUSTED_ORIGINS,
  createCloudAuth,
} from "./auth/better-auth";
import { RedisRateLimitStore } from "./auth/redis-rate-limit";

function authSecret(): string {
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return secret;
}

export async function createRuntimeApp() {
  const db = createDb(requiredEnv("DATABASE_URL"), {
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  const redis = createClient({ url: requiredEnv("REDIS_ADMIN_URL") });
  redis.on("error", (error) => {
    console.error("Redis connection error", error);
  });
  await redis.connect();

  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const auth = createCloudAuth({
    baseURL,
    cookieDomain: process.env.COOKIE_DOMAIN,
    db,
    secret: authSecret(),
    trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
  });
  const storageConfig = storageConfigFromEnv();
  const legacyS3AccessKeyId = process.env.S3_ACCESS_KEY_ID || undefined;
  const legacyS3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY || undefined;
  if (
    (legacyS3AccessKeyId === undefined) !==
    (legacyS3SecretAccessKey === undefined)
  ) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together",
    );
  }
  if (legacyS3AccessKeyId && legacyS3SecretAccessKey) {
    await ensureLegacyS3Credential(db, {
      accessKeyId: legacyS3AccessKeyId,
      secretAccessKey: legacyS3SecretAccessKey,
      keyEncryptionSecret: storageConfig.s3.credentialEncryptionKey,
    });
  }
  const meili = createMeiliClient(
    requiredEnv("MEILISEARCH_URL"),
    requiredEnv("MEILISEARCH_ADMIN_KEY"),
  );
  const tieringRepository = createTieringRepository(db);
  const promotions = new PromotionQueue(tieringRepository, {
    ssdStoragePath: storageConfig.ssdStoragePath,
    hddStoragePath: storageConfig.hddStoragePath,
  });
  const storageService = new StorageService(
    db,
    meili,
    storageConfig,
    promotions,
  );
  const s3Config = {
    rootPath: storageConfig.s3.rootPath,
    tempPath: storageConfig.s3.tempPath,
    region: storageConfig.s3.region,
    credentials: new S3CredentialResolver(
      db,
      storageConfig.s3.credentialEncryptionKey,
      storageConfig.s3.credentialCacheTtlMs,
    ),
  };
  await Promise.all([
    storageService.initialize(),
    ensureStorageSearchIndex(meili),
    initializeS3(s3Config),
  ]);
  const cleanupTimer = setInterval(
    () => {
      void storageService.cleanupExpiredUploads().catch((error) => {
        console.error("Upload cleanup failed", error);
      });
    },
    60 * 60 * 1_000,
  );
  cleanupTimer.unref();

  const app = createCloudApiApp({
    auth,
    db,
    isProduction: process.env.NODE_ENV === "production",
    rateLimitStore: new RedisRateLimitStore(redis),
    storage: { service: storageService, s3: s3Config },
    trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
  });
  return Object.assign(app, {
    async closeRuntime(): Promise<void> {
      clearInterval(cleanupTimer);
      await Promise.all([redis.quit(), db.$client.end()]);
    },
  });
}
