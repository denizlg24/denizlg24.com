import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getStorageEnv } from "../lib/env";
import { getLegacyR2Config, getS3ClientOptions } from "../lib/storage";

const execute = process.argv.includes("--execute");
const explicitDryRun = process.argv.includes("--dry-run");
if (execute && explicitDryRun) {
  throw new Error("--execute and --dry-run cannot be used together");
}

const prefix =
  process.argv
    .find((argument) => argument.startsWith("--prefix="))
    ?.slice("--prefix=".length) ?? "";

const env = getStorageEnv();
const legacy = getLegacyR2Config(env);
if (!legacy) {
  throw new Error("Legacy R2 credentials are required for this migration");
}

const source = new S3Client(legacy.clientOptions);
const destination = new S3Client(getS3ClientOptions(env));

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

async function destinationBucketExists() {
  try {
    await destination.send(
      new HeadBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function destinationObjectExists(key: string) {
  try {
    await destination.send(
      new HeadObjectCommand({ Bucket: env.ENVOY_S3_BUCKET, Key: key }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

let bucketExists = await destinationBucketExists();
if (execute && !bucketExists) {
  await destination.send(
    new CreateBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }),
  );
  bucketExists = true;
}

const summary = {
  mode: execute ? "execute" : "dry-run",
  prefix,
  scanned: 0,
  copied: 0,
  alreadyPresent: 0,
  wouldCopy: 0,
  bytesCopied: 0,
};

let continuationToken: string | undefined;
do {
  const page = await source.send(
    new ListObjectsV2Command({
      Bucket: legacy.bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }),
  );

  for (const object of page.Contents ?? []) {
    if (!object.Key) continue;
    summary.scanned += 1;

    if (bucketExists && (await destinationObjectExists(object.Key))) {
      summary.alreadyPresent += 1;
      continue;
    }

    if (!execute) {
      summary.wouldCopy += 1;
      continue;
    }

    const sourceObject = await source.send(
      new GetObjectCommand({ Bucket: legacy.bucket, Key: object.Key }),
    );
    if (!sourceObject.Body) {
      throw new Error(`R2 object has no body: ${object.Key}`);
    }
    const body = await sourceObject.Body.transformToByteArray();

    await destination.send(
      new PutObjectCommand({
        Bucket: env.ENVOY_S3_BUCKET,
        Key: object.Key,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: sourceObject.ContentType,
        CacheControl: sourceObject.CacheControl,
        ContentDisposition: sourceObject.ContentDisposition,
        Metadata: sourceObject.Metadata,
      }),
    );
    summary.copied += 1;
    summary.bytesCopied += body.byteLength;
  }

  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

console.log(JSON.stringify(summary));
