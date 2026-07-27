import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  EnvoyHealthCheckResult,
  EnvoyServiceHealth,
} from "@repo/schemas/envoy";
import { getEnv } from "./env";
import { prisma } from "./prisma";

async function checkDatabase(): Promise<EnvoyServiceHealth> {
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

async function checkStorage(): Promise<EnvoyServiceHealth> {
  const start = Date.now();
  try {
    const env = getEnv();
    const client = new S3Client({
      region: env.ENVOY_S3_REGION,
      endpoint: env.ENVOY_S3_ENDPOINT.replace(/\/+$/, ""),
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.ENVOY_S3_ACCESS_KEY_ID,
        secretAccessKey: env.ENVOY_S3_SECRET_ACCESS_KEY,
      },
    });

    await client.send(new HeadBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }));
    return { healthy: true, responseTime: Date.now() - start };
  } catch (e) {
    return {
      healthy: false,
      responseTime: Date.now() - start,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

async function checkGitHub(): Promise<EnvoyServiceHealth> {
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

export async function performHealthCheck(): Promise<EnvoyHealthCheckResult> {
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
