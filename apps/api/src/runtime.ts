import {
  ActivityRecorder,
  cloudEnv,
  createDb,
  createMeiliClient,
  createNamespaceSource,
  createProjectionRepository,
  createProjectPgClientFactory,
  createProvisionerRegistry,
  createTieringRepository,
  DockerClient,
  databaseActivitySink,
  ensureLegacyS3Credential,
  ensureStorageSearchIndex,
  findTaskByType,
  indexingProjectionRepository,
  initializeS3,
  MongoProvisioner,
  NamespaceMetadataClient,
  NamespaceSyncSupervisor,
  PostgresProvisioner,
  PromotionQueue,
  RedisProvisioner,
  requiredEnv,
  S3CredentialResolver,
  StorageService,
  SyncWorker,
  seedDefaultAlertRules,
  storageConfigFromEnv,
  syncRedisProjectAclUsers,
} from "@repo/cloud-core";
import { smbCredentials } from "@repo/cloud-core/db/schema";
import {
  CloudflareCustomHostnameClient,
  CloudflareDnsClient,
  cloudflareDeployConfigFromEnv,
  GithubAppClient,
  type GithubAppConfig,
  githubAppConfigFromEnv,
} from "@repo/cloud-core/deploy";
import type { DiskKind } from "@repo/schemas/cloud";
import { eq } from "drizzle-orm";
import { MongoClient } from "mongodb";
import { createClient } from "redis";

import { createCloudApiApp } from "./app";
import {
  CLOUD_AUTH_TRUSTED_ORIGINS,
  createCloudAuth,
} from "./auth/better-auth";
import { RedisRateLimitStore } from "./auth/redis-rate-limit";
import { mongoDbAdminRoutes, postgresDbAdminRoutes } from "./db-admin/routes";
import { GithubSurfaces } from "./deploy/github-surfaces";
import { ForgeOps } from "./deploy/ops";
import { DeployAgentProxy } from "./deploy/proxy";
import { deployRoutes } from "./deploy/routes";
import { OpsHealthService } from "./ops/health";
import type { DiskDevice } from "./ops/host";
import {
  databaseClaimStore,
  EmailNotifier,
  NotificationDispatcher,
  WebhookNotifier,
} from "./ops/notifications";
import { opsRoutes } from "./ops/routes";
import { MetricsSampler } from "./ops/sampler";
import { OpsScheduler } from "./ops/scheduler";
import { projectRoutes } from "./projects/routes";
import { TerminalGateway } from "./terminal/gateway";
import { TerminalWebSocketProxy } from "./terminal/proxy";

function authSecret(): string {
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  return secret;
}

function numberEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
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
    const mongoSync = new MongoClient(cloudEnv("MONGODB_URI"), mongoOptions);
    const mongoAdmin = new MongoClient(
      requiredEnv("MONGODB_ADMIN_URI"),
      mongoOptions,
    );
    cleanupActions.push(
      async () => mongoSync.close(),
      async () => mongoAdmin.close(),
    );
    await Promise.all([mongoSync.connect(), mongoAdmin.connect()]);

    const baseURL = cloudEnv("BETTER_AUTH_URL");
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
    const promotions = new PromotionQueue(
      tieringRepository,
      {
        ssdStoragePath: storageConfig.ssdStoragePath,
        hddStoragePath: storageConfig.hddStoragePath,
      },
      storageConfig.namespace.mode === "legacy-dual-path",
    );
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
    const docker = new DockerClient();
    // Either a filesystem UUID or a `/dev/...` path, per entry. Both spellings
    // are accepted so the image and `.env.pi` can roll separately; a UUID is
    // what survives the kernel renaming disks on the next reboot, so prefer it.
    const devices: DiskDevice[] = [];
    const addDevice = (value: string | undefined, kind: DiskKind) => {
      const normalized = value?.trim();
      if (!normalized) return;
      devices.push(
        normalized.startsWith("/dev/")
          ? { device: normalized, kind }
          : { uuid: normalized, kind },
      );
    };
    addDevice(process.env.SSD_DEVICE, "ssd");
    for (const device of (process.env.HDD_DEVICES ?? "").split(",")) {
      addDevice(device, "hdd");
    }
    addDevice(process.env.MICROSD_DEVICE, "microsd");
    const sampler = new MetricsSampler({
      db,
      docker,
      devices,
      mongo: mongoAdmin,
      redis,
    });
    cleanupActions.push(() => sampler.stop());
    await sampler.start();
    // No-ops once any rule exists, so a deleted or retuned default stays that
    // way across restarts.
    await seedDefaultAlertRules(db).catch((error) => {
      console.error("[alerts] Seeding default rules failed", error);
    });
    // The deploy surface is optional: a host with no agent to reach mounts
    // nothing rather than answering every route with a 503 nobody can act on.
    // Built here rather than beside the routes because the health check and the
    // two scheduled passes need the same object.
    let cloudflareDeployConfig: ReturnType<
      typeof cloudflareDeployConfigFromEnv
    > | null = null;
    try {
      cloudflareDeployConfig = cloudflareDeployConfigFromEnv();
    } catch {
      cloudflareDeployConfig = null;
    }
    const deployAgentUrl = process.env.DEPLOY_AGENT_URL?.trim();
    const deployAgentToken = process.env.DEPLOY_AGENT_TOKEN?.trim();
    const forge =
      deployAgentUrl && deployAgentToken
        ? new ForgeOps({
            db,
            agent: new DeployAgentProxy({
              baseUrl: deployAgentUrl,
              token: deployAgentToken,
            }),
            // Cloudflare is configured separately. Without it a deployment
            // still builds, runs and routes through Caddy — it just has no
            // public name, which is a better failure than refusing to deploy.
            dns: cloudflareDeployConfig
              ? new CloudflareDnsClient({ config: cloudflareDeployConfig })
              : null,
            // Same credentials, separate client: a zone record and a custom
            // hostname are different mechanisms and only one of them is
            // quota-limited, so nothing should be able to reach for the wrong
            // one by accident.
            customHostnames: cloudflareDeployConfig
              ? new CloudflareCustomHostnameClient({
                  config: cloudflareDeployConfig,
                })
              : null,
            zoneName: cloudflareDeployConfig?.zoneName ?? "denizlg24.com",
          })
        : null;

    const health = new OpsHealthService({
      db,
      mongo: mongoAdmin,
      redis,
      sampler,
      meilisearchUrl: requiredEnv("MEILISEARCH_URL"),
      mongotUrl: process.env.MONGOT_HEALTH_URL ?? "http://mongot:8080",
      tunnelUrl: process.env.TUNNEL_HEALTH_URL || undefined,
      // The agent's own `/healthz` pings Docker and stats the data root, so a
      // 200 from it means it can actually build — not merely that it is up.
      forgeUrl: deployAgentUrl && forge ? `${deployAgentUrl}/healthz` : null,
      forgeToken: deployAgentToken ?? null,
      diskHeadroomPercent: numberEnv("DISK_MIN_HEADROOM_PERCENT", 10, 1, 99),
    });
    const activityRecorder = new ActivityRecorder({
      sink: databaseActivitySink(db),
    });
    activityRecorder.start();
    cleanupActions.push(async () => activityRecorder.stop());
    const notifications = new NotificationDispatcher({
      claims: databaseClaimStore(db),
      notifiers: [
        new WebhookNotifier(
          process.env.METRICS_NOTIFICATION_WEBHOOK_URL || undefined,
        ),
        new EmailNotifier({
          apiKey: process.env.RESEND_API_KEY || undefined,
          from: process.env.OPS_ALERT_EMAIL_FROM || undefined,
          to: process.env.OPS_ALERT_EMAIL_TO || undefined,
        }),
      ],
    });
    // The same privileged socket the namespace uses. Only present in broker
    // mode; in legacy mode there is no host agent and no SMB boundary.
    const metadataClient =
      storageConfig.namespace.mode === "broker-mounted" &&
      storageConfig.namespace.metadata
        ? new NamespaceMetadataClient(storageConfig.namespace.metadata)
        : null;

    const scheduler = new OpsScheduler({
      db,
      notifications,
      adminBaseUrl:
        process.env.CLOUD_ADMIN_URL ?? "https://cloud.denizlg24.com",
      executorContext: {
        db,
        meili,
        docker,
        health,
        notifications,
        sampler,
        storageConfig,
        metadataClient,
        forge,
        backupDirectory: process.env.BACKUP_DIR ?? "/backups",
        postgresContainer: process.env.POSTGRES_CONTAINER ?? "postgres",
        mongoContainer: process.env.MONGODB_CONTAINER ?? "mongodb",
        rebootSentinelPath:
          process.env.REBOOT_SENTINEL_PATH ?? "/host-control/reboot-requested",
        activityRetentionDays: numberEnv(
          "ACTIVITY_LOG_RETENTION_DAYS",
          30,
          1,
          365,
        ),
        containerRestartCounts: new Map(),
        downServices: new Set(),
      },
    });
    cleanupActions.push(async () => scheduler.stop());
    await scheduler.start();

    // The low-latency half of the projection. The scan task remains the
    // authority on completeness; this only shortens the window in which an SMB
    // write is on disk but not yet in PostgreSQL, and every way it can fail
    // ends in the same place — request the scan it cannot replace.
    if (
      metadataClient &&
      storageConfig.namespace.mode === "broker-mounted" &&
      process.env.STORAGE_NAMESPACE_WATCH !== "off"
    ) {
      const projectionRepository = indexingProjectionRepository(
        createProjectionRepository(db),
        db,
        meili,
      );
      const namespaceSource = createNamespaceSource(
        metadataClient,
        storageConfig.namespace.rootPath,
        // Adoption asks the metadata service who wrote a path and gets back an
        // SMB principal; only this side can turn that into an account, because
        // the privileged service holds no database handle by design.
        async (principal) => {
          const [credential] = await db
            .select({ userId: smbCredentials.userId })
            .from(smbCredentials)
            .where(eq(smbCredentials.principal, principal))
            .limit(1);
          return credential?.userId ?? null;
        },
      );
      const sync = new NamespaceSyncSupervisor({
        client: metadataClient,
        onEvent: (event) => {
          // Applied batches are the steady state and would dominate the log.
          if (event.type === "applied") return;
          console.info(JSON.stringify({ event: "namespace-sync", ...event }));
        },
        repository: projectionRepository,
        requestFullScan: async (reason) => {
          const task = await findTaskByType(db, "namespace_scan");
          if (!task)
            throw new Error(`No namespace_scan task to run (${reason})`);
          await scheduler.runTask(task.id);
        },
        source: namespaceSource,
      });
      sync.start();
      cleanupActions.push(async () => sync.stop());
    }
    const terminal = new TerminalGateway({
      serverUrl: process.env.TERMINAL_SERVER_URL ?? "ws://127.0.0.1:3003",
      ticketSecret: requiredEnv("TERMINAL_TICKET_SECRET"),
    });

    // Optional in the same way the agent is: without the App a target still
    // deploys, it just has to be told which commit and cannot clone a private
    // repository or write anything back to a pull request.
    let githubApp: GithubAppConfig | null = null;
    try {
      githubApp = githubAppConfigFromEnv();
    } catch {
      githubApp = null;
    }
    const github = githubApp
      ? (() => {
          const client = new GithubAppClient({
            config: githubApp,
            cache: {
              get: async (key) => redis.get(key),
              set: async (key, value, ttlSeconds) => {
                await redis.set(key, value, { EX: ttlSeconds });
              },
              delete: async (key) => {
                await redis.del(key);
              },
            },
          });
          return {
            client,
            surfaces: new GithubSurfaces({
              db,
              client,
              adminBaseUrl:
                process.env.CLOUD_ADMIN_URL ?? "https://cloud.denizlg24.com",
            }),
          };
        })()
      : null;

    const deploy =
      forge && deployAgentToken
        ? deployRoutes({
            db,
            forge,
            github,
            githubAppSlug: githubApp?.slug ?? null,
            // No decrypt exists yet, so a linked target pulls nothing.
            envoyEnv: null,
            agentToken: deployAgentToken,
            envEncryptionKey: requiredEnv("DEPLOY_ENV_ENCRYPTION_KEY"),
            databaseEncryptionSecret,
            databaseHosts,
            s3Endpoint:
              process.env.DEPLOY_S3_ENDPOINT ?? "https://api.denizlg24.com/v2",
            s3Region: process.env.DEPLOY_S3_REGION ?? "auto",
            s3CredentialEncryptionKey: storageConfig.s3.credentialEncryptionKey,
          })
        : undefined;

    const app = createCloudApiApp({
      auth,
      db,
      isProduction: process.env.NODE_ENV === "production",
      rateLimitStore: new RedisRateLimitStore(redis),
      storage: {
        service: storageService,
        s3: s3Config,
        // Provisioning reaches the privileged host agent over the same socket
        // the namespace metadata uses. Absent in legacy mode, where there is
        // no Samba boundary to provision into.
        smbProvisioner: metadataClient
          ? {
              provision: (input) => metadataClient.provisionSmb(input),
              revoke: (principal) => metadataClient.revokeSmb(principal),
            }
          : undefined,
      },
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
      activity: {
        recorder: activityRecorder,
        slowRequestMs: numberEnv(
          "ACTIVITY_SLOW_REQUEST_MS",
          3_000,
          100,
          60_000,
        ),
      },
      ops: opsRoutes({
        db,
        docker,
        health,
        notifications,
        adminBaseUrl:
          process.env.CLOUD_ADMIN_URL ?? "https://cloud.denizlg24.com",
        storageConfig,
        sampler,
        scheduler,
        terminal,
      }),
      deploy,
      opsTools: {
        adminerUrl:
          process.env.ADMINER_URL ??
          (process.env.NODE_ENV === "production"
            ? undefined
            : "http://127.0.0.1:8081"),
        mongoExpressUrl:
          process.env.MONGO_EXPRESS_URL ??
          (process.env.NODE_ENV === "production"
            ? undefined
            : "http://127.0.0.1:8082"),
      },
      trustedOrigins: CLOUD_AUTH_TRUSTED_ORIGINS,
    });
    return Object.assign(app, {
      closeRuntime: cleanup,
      terminalProxy: new TerminalWebSocketProxy(terminal),
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
