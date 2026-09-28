import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | undefined;
let ensurePromise: Promise<void> | undefined;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getBucket() {
  return required("MACROS_S3_BUCKET");
}

function getClient() {
  client ??= new S3Client({
    endpoint: required("MACROS_S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.MACROS_S3_REGION ?? "eu-west-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("MACROS_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("MACROS_S3_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function isNotFound(error: unknown) {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate?.name === "NoSuchBucket" ||
    candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}

async function ensureBucket() {
  const bucket = getBucket();
  ensurePromise ??= (async () => {
    try {
      await getClient().send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await getClient().send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  try {
    await ensurePromise;
  } catch (error) {
    ensurePromise = undefined;
    throw error;
  }
  return bucket;
}

export async function createBodyPhotoUploadUrl(
  key: string,
  contentType: string,
) {
  const bucket = await ensureBucket();
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );
}

export async function createBodyPhotoDownloadUrl(key: string) {
  const bucket = await ensureBucket();
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 900 },
  );
}

export async function inspectBodyPhoto(key: string) {
  const bucket = await ensureBucket();
  return getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteBodyPhotoObject(key: string) {
  const bucket = await ensureBucket();
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Everything a user uploads lives under this prefix, including uploads that
// were presigned but never registered, which no database row points at.
export async function deleteUserObjects(userId: string) {
  const bucket = await ensureBucket();
  const client = getClient();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `users/${userId}/`,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    );
    if (keys.length > 0) {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      );
      const failed = result.Errors ?? [];
      if (failed.length > 0) {
        throw new Error(
          `Could not delete ${failed.length} stored object(s) for the account: ${failed[0]?.Code ?? "unknown error"}`,
        );
      }
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
}
