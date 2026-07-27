import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { prisma } from "./prisma";
import { env } from "./env";

export interface ServiceHealth {
  healthy: boolean;
  responseTime: number;
  error?: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  responseTime: number;
  services: {
    database: ServiceHealth;
    storage: ServiceHealth;
    github: ServiceHealth;
  };
}

async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, responseTime: Date.now() - start };
  } catch (e) {
    return {
      healthy: false,
      responseTime: Date.now() - start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

async function checkStorage(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    await client.send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }));
    return { healthy: true, responseTime: Date.now() - start };
  } catch (e) {
    return {
      healthy: false,
      responseTime: Date.now() - start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

async function checkGitHub(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const res = await fetch("https://api.github.com/zen", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return {
        healthy: false,
        responseTime: Date.now() - start,
        error: `GitHub returned ${res.status}`,
      };
    }
    return { healthy: true, responseTime: Date.now() - start };
  } catch (e) {
    return {
      healthy: false,
      responseTime: Date.now() - start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function performHealthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  const [database, storage, github] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkGitHub(),
  ]);

  const healthy = database.healthy && storage.healthy && github.healthy;

  return {
    healthy,
    responseTime: Date.now() - start,
    services: { database, storage, github },
  };
}
