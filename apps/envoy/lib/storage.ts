import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";


const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export async function getUploadUrl(
  key: string,
  expiresInSeconds = 300
) {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    method: "PUT",
    url,
  };
}

export async function getDownloadUrl(
  key: string,
  expiresInSeconds = 300
) {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    method: "GET",
    url,
  };
}

export async function objectExists(key: string) {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
      })
    );

    return true;
  } catch {
    return false;
  }
}

export function blobKey(
  userId: string,
  projectId: string,
  hash: string
) {
  return `${userId}/${projectId}/blobs/${hash}.blob`;
}

export function manifestKey(
  userId: string,
  projectId: string,
  hash: string
) {
  return `${userId}/${projectId}/manifests/${hash}.enc`;
}

export function commitKey(
  userId: string,
  projectId: string,
  hash: string
) {
  return `${userId}/${projectId}/commits/${hash}.enc`;
}
