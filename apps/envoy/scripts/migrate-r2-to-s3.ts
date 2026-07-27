import { createHash } from "node:crypto";
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
const verify = process.argv.includes("--verify");
if ([execute, explicitDryRun, verify].filter(Boolean).length > 1) {
  throw new Error("--execute, --dry-run, and --verify cannot be used together");
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

async function readObject(client: S3Client, bucket: string, key: string) {
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!object.Body) {
    throw new Error(`Object has no body: ${key}`);
  }
  return object.Body.transformToByteArray();
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

let bucketExists = await destinationBucketExists();
if (execute && !bucketExists) {
  await destination.send(
    new CreateBucketCommand({ Bucket: env.ENVOY_S3_BUCKET }),
  );
  bucketExists = true;
}

const summary = {
  mode: verify ? "verify" : execute ? "execute" : "dry-run",
  prefix,
  scanned: 0,
  copied: 0,
  alreadyPresent: 0,
  wouldCopy: 0,
  bytesCopied: 0,
  verified: 0,
  missing: 0,
  mismatched: 0,
  bytesVerified: 0,
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

    const destinationHasObject =
      bucketExists && (await destinationObjectExists(object.Key));

    if (verify) {
      if (!destinationHasObject) {
        summary.missing += 1;
        continue;
      }

      const [sourceBytes, destinationBytes] = await Promise.all([
        readObject(source, legacy.bucket, object.Key),
        readObject(destination, env.ENVOY_S3_BUCKET, object.Key),
      ]);
      if (
        sourceBytes.byteLength === destinationBytes.byteLength &&
        digest(sourceBytes) === digest(destinationBytes)
      ) {
        summary.verified += 1;
        summary.bytesVerified += sourceBytes.byteLength;
      } else {
        summary.mismatched += 1;
      }
      continue;
    }

    if (destinationHasObject) {
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

if (verify && (summary.missing > 0 || summary.mismatched > 0)) {
  process.exitCode = 1;
}
