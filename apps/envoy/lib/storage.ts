import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type EnvoyStorageEnv, getEnv } from "./env";

export function getS3ClientOptions(env: EnvoyStorageEnv) {
  return {
    region: env.ENVOY_S3_REGION,
    endpoint: env.ENVOY_S3_ENDPOINT.replace(/\/+$/, ""),
    // The denizlg24 cloud gateway exposes buckets below /v2 and intentionally
    // supports path-style addressing only.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.ENVOY_S3_ACCESS_KEY_ID,
      secretAccessKey: env.ENVOY_S3_SECRET_ACCESS_KEY,
    },
  } as const;
}

export function getLegacyR2Config(env: EnvoyStorageEnv) {
  const values = [
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => value === undefined)) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET must be configured together",
    );
  }

  return {
    bucket: env.R2_BUCKET as string,
    clientOptions: {
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
      },
    },
  } as const;
}

let primaryClient: S3Client | undefined;
let legacyClient: S3Client | undefined;
let ensureBucketPromise: Promise<void> | undefined;

function getPrimaryClient() {
  primaryClient ??= new S3Client(getS3ClientOptions(getEnv()));
  return primaryClient;
}

function getLegacyLocation() {
  const config = getLegacyR2Config(getEnv());
  if (!config) return null;
  legacyClient ??= new S3Client(config.clientOptions);
  return { client: legacyClient, bucket: config.bucket };
}

function isNotFound(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchBucket" ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

async function objectExistsAt(client: S3Client, bucket: string, key: string) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function ensureBucket() {
  ensureBucketPromise ??= (async () => {
    const env = getEnv();
    try {
      await getPrimaryClient().send(
        new HeadBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await getPrimaryClient().send(
        new CreateBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }),
      );
    }
  })();

  try {
    await ensureBucketPromise;
  } catch (error) {
    ensureBucketPromise = undefined;
    throw error;
  }
}

export async function getUploadUrl(key: string, expiresInSeconds = 300) {
  await ensureBucket();
  const command = new PutObjectCommand({
    Bucket: getEnv().ENVOY_S3_BUCKET,
    Key: key,
  });
  const url = await getSignedUrl(getPrimaryClient(), command, {
    expiresIn: expiresInSeconds,
  });
  return { method: "PUT", url } as const;
}

export async function getDownloadUrl(key: string, expiresInSeconds = 300) {
  await ensureBucket();
  const env = getEnv();
  let client = getPrimaryClient();
  let bucket = env.ENVOY_S3_BUCKET;

  if (!(await objectExistsAt(client, bucket, key))) {
    const legacy = getLegacyLocation();
    if (legacy && (await objectExistsAt(legacy.client, legacy.bucket, key))) {
      ({ client, bucket } = legacy);
    }
  }

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
  return { method: "GET", url } as const;
}

export async function objectExists(key: string) {
  await ensureBucket();
  const env = getEnv();
  if (await objectExistsAt(getPrimaryClient(), env.ENVOY_S3_BUCKET, key)) {
    return true;
  }

  const legacy = getLegacyLocation();
  return legacy ? objectExistsAt(legacy.client, legacy.bucket, key) : false;
}

export function blobKey(userId: string, projectId: string, hash: string) {
  return `${userId}/${projectId}/blobs/${hash}.blob`;
}

export function manifestKey(userId: string, projectId: string, hash: string) {
  return `${userId}/${projectId}/manifests/${hash}.enc`;
}

export function commitKey(userId: string, projectId: string, hash: string) {
  return `${userId}/${projectId}/commits/${hash}.enc`;
}
