import {
  createDb,
  createMeiliClient,
  createProjectPgClientFactory,
  createProvisionerRegistry,
  createTieringRepository,
  ensureLegacyS3Credential,
  ensureStorageSearchIndex,
  initializeS3,
  MongoProvisioner,
  PostgresProvisioner,
  PromotionQueue,
  RedisProvisioner,
  requiredEnv,
  S3CredentialResolver,
  StorageService,
  SyncWorker,
  storageConfigFromEnv,
  syncRedisProjectAclUsers,
} from "@repo/cloud-core";
import { MongoClient } from "mongodb";
import { createClient } from "redis";

import { createCloudApiApp } from "./app";
import {
  CLOUD_AUTH_TRUSTED_ORIGINS,
  createCloudAuth,
} from "./auth/better-auth";
import { RedisRateLimitStore } from "./auth/redis-rate-limit";
import { mongoDbAdminRoutes, postgresDbAdminRoutes } from "./db-admin/routes";
import { projectRoutes } from "./projects/routes";

function authSecret(): string {
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return secret;
}

export async function createRuntimeApp() {
  const cleanupActions: Array<() => Promise<void> | void> = [];
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    for (const action of cleanupActions.reverse()) {
      try {
        await action();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Runtime cleanup failed");
    }
  };

  try {
    const databaseUrl = requiredEnv("DATABASE_URL");
    const db = createDb(databaseUrl, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
    });
    cleanupActions.push(async () => db.$client.end());
    const redis = createClient({ url: requiredEnv("REDIS_ADMIN_URL") });
    redis.on("error", (error) => {
      console.error("Redis connection error", error);
    });
    await redis.connect();
    cleanupActions.push(async () => {
      await redis.quit();
    });
    const mongoOptions = {
      connectTimeoutMS: 5_000,
      serverSelectionTimeoutMS: 5_000,
    };
    const mongoSync = new MongoClient(requiredEnv("MONGODB_URI"), mongoOptions);
    const mongoAdmin = new MongoClient(
      requiredEnv("MONGODB_ADMIN_URI"),
      mongoOptions,
    );
    cleanupActions.push(
      async () => mongoSync.close(),
      async () => mongoAdmin.close(),
    );
    await Promise.all([mongoSync.connect(), mongoAdmin.connect()]);

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
    const legacyS3SecretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY || undefined;
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
    const meiliMasterKey =
      process.env.MEILI_MASTER_KEY || process.env.MEILISEARCH_ADMIN_KEY;
    if (!meiliMasterKey) {
      throw new Error(
        "MEILI_MASTER_KEY or MEILISEARCH_ADMIN_KEY must be configured",
      );
    }
    const meili = createMeiliClient(
      requiredEnv("MEILISEARCH_URL"),
      meiliMasterKey,
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
    const s3CredentialResolver = new S3CredentialResolver(
      db,
      storageConfig.s3.credentialEncryptionKey,
      storageConfig.s3.credentialCacheTtlMs,
    );
    const s3Config = {
      rootPath: storageConfig.s3.rootPath,
      tempPath: storageConfig.s3.tempPath,
      region: storageConfig.s3.region,
      credentials: s3CredentialResolver,
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
    cleanupActions.push(() => clearInterval(cleanupTimer));

    const databaseEncryptionSecret =
      process.env.DATABASE_CREDENTIAL_ENCRYPTION_KEY ||
      process.env.TOTP_ENCRYPTION_KEY;
    if (!databaseEncryptionSecret) {
      throw new Error(
        "DATABASE_CREDENTIAL_ENCRYPTION_KEY or TOTP_ENCRYPTION_KEY must be configured",
      );
    }
    const redisCommander = {
      async sendCommand(args: string[]): Promise<unknown> {
        return redis.sendCommand(args);
      },
    };
    const provisioners = createProvisionerRegistry([
      new PostgresProvisioner(databaseUrl),
      new MongoProvisioner(mongoAdmin),
      new RedisProvisioner(redisCommander),
    ]);
    await syncRedisProjectAclUsers(
      db,
      redisCommander,
      databaseEncryptionSecret,
    );
    const pgClientFactory = createProjectPgClientFactory(databaseUrl);
    const syncWorker = new SyncWorker({
      db,
      mongo: mongoSync,
      meili,
      pgClientFactory,
    });
    cleanupActions.push(async () => syncWorker.stop());
    await syncWorker.start();
    const databaseHosts = {
      postgresInternal: process.env.POSTGRES_INTERNAL_HOST ?? "postgres:5432",
      postgresExternal:
        process.env.POSTGRES_EXTERNAL_HOST ?? "postgres.denizlg24.com:5433",
      mongodbInternal: process.env.MONGODB_INTERNAL_HOST ?? "mongodb:27017",
      mongodbExternal:
        process.env.MONGODB_EXTERNAL_HOST ?? "mongodb.denizlg24.com:27018",
      redisInternal: process.env.REDIS_INTERNAL_HOST ?? "redis:6379",
      redisExternal:
        process.env.REDIS_EXTERNAL_HOST ?? "redis.denizlg24.com:6380",
    };
    const maxVectorIndexes = Number(
      process.env.MONGOT_MAX_INDEXES_PER_PROJECT ?? 5,
    );
    if (
      !Number.isInteger(maxVectorIndexes) ||
      maxVectorIndexes < 1 ||
      maxVectorIndexes > 50
    ) {
      throw new Error(
        "MONGOT_MAX_INDEXES_PER_PROJECT must be an integer from 1 to 50",
      );
    }
    const platformOptions = {
      db,
      databaseUrl,
      mongo: mongoAdmin,
    };

    const app = createCloudApiApp({
      auth,
      db,
      isProduction: process.env.NODE_ENV === "production",
      rateLimitStore: new RedisRateLimitStore(redis),
      storage: { service: storageService, s3: s3Config },
      platform: {
        projects: projectRoutes({
          db,
          meili,
          mongo: mongoAdmin,
          syncWorker,
          pgClientFactory,
          provisioners,
          databaseEncryptionSecret,
          databaseHosts,
          s3CredentialEncryptionKey: storageConfig.s3.credentialEncryptionKey,
          s3CredentialResolver,
          mongotHealthUrl:
            process.env.MONGOT_HEALTH_URL ?? "http://mongot:8080",
          mongotMaxIndexesPerProject: maxVectorIndexes,
        }),
        postgres: postgresDbAdminRoutes(platformOptions),
        mongodb: mongoDbAdminRoutes(platformOptions),
      },
      trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
    });
    return Object.assign(app, {
      closeRuntime: cleanup,
    });
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("Runtime initialization cleanup failed", cleanupError);
    }
    throw error;
  }
}
