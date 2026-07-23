import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ensureLocalSmokeRuntime } from "./smoke-runtime";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const endpoint = env("S3_SMOKE_ENDPOINT", "http://127.0.0.1:3000/v2");
const region = env("S3_SMOKE_REGION", "eu-west-1");
const bucket = env("S3_SMOKE_BUCKET");
const projectBucket = env("S3_SMOKE_PROJECT_BUCKET");
const forbiddenBucket = env("S3_SMOKE_FORBIDDEN_BUCKET");
const shareUrl = env("S3_SMOKE_SHARE_URL");
const runtime = await ensureLocalSmokeRuntime(endpoint);

function s3Client(prefix: string): S3Client {
  return new S3Client({
    endpoint,
    forcePathStyle: true,
    region,
    maxAttempts: 1,
    credentials: {
      accessKeyId: env(`${prefix}_ACCESS_KEY_ID`),
      secretAccessKey: env(`${prefix}_SECRET_ACCESS_KEY`),
    },
  });
}

const legacy = s3Client("S3_SMOKE_LEGACY");
const project = s3Client("S3_SMOKE_PROJECT");
const key = `smoke/${crypto.randomUUID()}.txt`;
const bytes = "deniz-cloud s3 smoke";

try {
  const buckets = await legacy.send(new ListBucketsCommand({}));
  if (!buckets.Buckets?.some((item) => item.Name === bucket)) {
    await legacy.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await legacy.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "text/plain",
    }),
  );
  const object = await legacy.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if ((await object.Body?.transformToString()) !== bytes) {
    throw new Error("S3 GET returned unexpected content");
  }
  const range = await legacy.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: "bytes=6-10",
    }),
  );
  if ((await range.Body?.transformToString()) !== "cloud") {
    throw new Error("S3 range GET returned unexpected content");
  }
  const listed = await legacy.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "smoke/" }),
  );
  if (!listed.Contents?.some((item) => item.Key === key)) {
    throw new Error("S3 list did not include the uploaded key");
  }

  const projectBuckets = await project.send(new ListBucketsCommand({}));
  if (!projectBuckets.Buckets?.some((item) => item.Name === projectBucket)) {
    await project.send(new CreateBucketCommand({ Bucket: projectBucket }));
  }
  if (projectBuckets.Buckets?.some((item) => item.Name !== projectBucket)) {
    throw new Error("Project credential listed a foreign bucket");
  }
  await project
    .send(new ListObjectsV2Command({ Bucket: forbiddenBucket }))
    .then(
      () => {
        throw new Error("Project credential accessed a foreign bucket");
      },
      (error: Error) => {
        if (error.name !== "AccessDenied") throw error;
      },
    );

  const shareResponse = await fetch(shareUrl, {
    headers: { Range: "bytes=0-4" },
  });
  const shareBody = await shareResponse.text();
  if (shareResponse.status !== 206 || shareBody.length !== 5) {
    throw new Error(
      `Share-link range fetch failed (${shareResponse.status}, ${shareBody.length} bytes)`,
    );
  }

  await legacy.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  if (process.env.S3_SMOKE_DELETE_BUCKET === "true") {
    await legacy.send(new DeleteBucketCommand({ Bucket: bucket }));
  }
  console.log("S3 smoke passed: put/get/range/list/delete/share/isolation");
} finally {
  legacy.destroy();
  project.destroy();
  await runtime?.stop();
}
