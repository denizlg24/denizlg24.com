import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
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
