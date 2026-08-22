import "server-only";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageBucket = "image" | "file" | "spreadsheet" | "voice";

interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  imagePrefix: string;
  filePrefix: string;
  spreadsheetPrefix: string;
  voicePrefix: string;
}

export interface StoredFile {
  /** S3 object key — used as the durable handle for delete/download. */
  id: string;
  filename: string;
  /** Same as `id`; kept for callers that persisted a `path` field. */
  path: string;
  mimeType: string;
  sizeBytes: number;
  /** Absolute URL that streams the object through the public `/api/file` proxy. */
  publicUrl: string;
}

export interface StorageObjectStream {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function getStorageConfig(): StorageConfig {
  return {
    endpoint: requireEnv("STORAGE_S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.STORAGE_S3_REGION?.trim() || "eu-west-1",
    accessKeyId: requireEnv("STORAGE_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("STORAGE_S3_SECRET_ACCESS_KEY"),
    bucket: requireEnv("STORAGE_S3_BUCKET"),
    imagePrefix: trimSlashes(
      process.env.STORAGE_IMAGE_UPLOAD_PATH ?? "uploads/images",
    ),
    filePrefix: trimSlashes(
      process.env.STORAGE_FILE_UPLOAD_PATH ?? "uploads/files",
    ),
    spreadsheetPrefix: trimSlashes(
      process.env.STORAGE_SPREADSHEET_UPLOAD_PATH ?? "spreadsheets",
    ),
    voicePrefix: trimSlashes(
      process.env.STORAGE_VOICE_UPLOAD_PATH ?? "uploads/voice-notes",
    ),
  };
}

/** Long enough for a slow 500MB push, short enough that a leaked URL rots. */
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const config = getStorageConfig();
  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    // deniz-cloud only implements path-style addressing (no virtual-host).
    forcePathStyle: true,
    // deniz-cloud answers 501 to `aws-chunked` bodies. On the default
    // (WHEN_SUPPORTED) the SDK wraps any *streaming* body in exactly that,
    // sending `x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER` and
    // dropping Content-Length. WHEN_REQUIRED skips the trailer for operations
    // that do not demand one, so a stream goes out as an ordinary PUT with
    // `UNSIGNED-PAYLOAD` — which `assertPayloadHash` accepts — and a real
    // Content-Length. A buffered body is unaffected either way.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return cachedClient;
}

let ensureBucketPromise: Promise<void> | null = null;

async function ensureBucket(): Promise<void> {
  if (ensureBucketPromise) return ensureBucketPromise;

  ensureBucketPromise = (async () => {
    const client = getClient();
    const { bucket } = getStorageConfig();
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (isNotFound(error)) {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        return;
      }
      throw error;
    }
  })();

  try {
    await ensureBucketPromise;
  } catch (error) {
    // Allow a later call to retry if bucket setup failed transiently.
    ensureBucketPromise = null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err.name === "NotFound" ||
    err.name === "NoSuchKey" ||
    err.name === "NoSuchBucket" ||
    err.$metadata?.httpStatusCode === 404
  );
}

function getBucketPrefix(bucket: StorageBucket): string {
  const config = getStorageConfig();
  switch (bucket) {
    case "image":
      return config.imagePrefix;
    case "file":
      return config.filePrefix;
    case "spreadsheet":
      return config.spreadsheetPrefix;
    case "voice":
      return config.voicePrefix;
  }
}

function splitFilename(name: string): { base: string; extension: string } {
  const trimmed = name.trim() || "upload";
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { base: trimmed, extension: "" };
  }
  return {
    base: trimmed.slice(0, dotIndex),
    extension: trimmed.slice(dotIndex).toLowerCase(),
  };
}

function slugifyBase(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "file";
}

function buildObjectKey(bucket: StorageBucket, filename: string): string {
  const { base, extension } = splitFilename(filename);
  return `${getBucketPrefix(bucket)}/${slugifyBase(base)}-${crypto.randomUUID()}${extension}`;
}

function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://denizlg24.com"
  );
}

function buildPublicUrl(key: string): string {
  const encoded = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${siteBaseUrl()}/api/file/${encoded}`;
}

/**
 * True when `key` sits under a bucket whose contents may be streamed by the
 * public `/api/file` proxy. Spreadsheet objects hold private admin JSON and are
 * deliberately excluded.
 */
export function isPubliclyServableKey(key: string): boolean {
  const config = getStorageConfig();
  const normalized = trimSlashes(key);
  return (
    normalized.startsWith(`${config.imagePrefix}/`) ||
    normalized.startsWith(`${config.filePrefix}/`)
  );
}

export interface StreamUploadMetadata {
  filename: string;
  mimeType: string;
  /** Only used to reject oversized uploads early; the wire body is chunked. */
  sizeBytes: number;
}

/**
 * Uploads without ever holding the object in memory.
 *
 * Not through the SDK's `send()`: its NodeHttpHandler reaches for `node:http`,
 * and Bun's shim for that buffers the whole request body before writing a byte.
 * Measured on 512MB — Node grows RSS by 4MB, Bun by 1122MB — and Forge starts
 * this app with `bun run start`, so the shim is the production path. `fetch`
 * with a `ReadableStream` body streams on both runtimes (+8MB on the same
 * measurement), so the SDK is used only to sign, and the transfer is a plain
 * PUT against the presigned URL.
 *
 * The signature carries `UNSIGNED-PAYLOAD`, which is what makes this possible
 * at all: deniz-cloud's `assertPayloadHash` accepts it without hashing, and it
 * rejects the `aws-chunked` encoding the SDK would otherwise reach for. No
 * Content-Length goes out — `validateContentLength` skips an absent header, and
 * the store sizes the object from what it wrote.
 */
export async function uploadStreamToStorage(
  body: ReadableStream<Uint8Array>,
  metadata: StreamUploadMetadata,
  bucket: StorageBucket,
): Promise<StoredFile> {
  await ensureBucket();

  const key = buildObjectKey(bucket, metadata.filename || "upload");
  const mimeType = metadata.mimeType || "application/octet-stream";
  const signedUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: getStorageConfig().bucket,
      Key: key,
      ContentType: mimeType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );

  const response = await fetch(signedUrl, {
    method: "PUT",
    // Exactly the headers the presigner signed; an extra one breaks the
    // signature and a missing one is treated as tampering.
    headers: { "content-type": mimeType },
    body,
    // Required to send a stream rather than buffering it first.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!response.ok) {
    throw new Error(
      `Storage upload failed with HTTP ${response.status}: ${(
        await response.text().catch(() => "")
      ).slice(0, 300)}`,
    );
  }

  return {
    id: key,
    filename: metadata.filename || key.split("/").pop() || key,
    path: key,
    mimeType,
    sizeBytes: metadata.sizeBytes,
    publicUrl: buildPublicUrl(key),
  };
}

export async function uploadFileToStorage(
  file: File,
  bucket: StorageBucket,
): Promise<StoredFile> {
  await ensureBucket();

  const key = buildObjectKey(bucket, file.name || "upload");
  const mimeType = file.type || "application/octet-stream";
  // deniz-cloud rejects `aws-chunked` streaming payloads, so the body must be
  // fully buffered — the SDK then signs an ordinary PUT with a real hash.
  const body = new Uint8Array(await file.arrayBuffer());

  await getClient().send(
    new PutObjectCommand({
      Bucket: getStorageConfig().bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: body.byteLength,
    }),
  );

  return {
    id: key,
    filename: file.name || key.split("/").pop() || key,
    path: key,
    mimeType,
    sizeBytes: file.size,
    publicUrl: buildPublicUrl(key),
  };
}

export async function deleteFileFromStorage(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: getStorageConfig().bucket,
        Key: key,
      }),
    );
  } catch (error) {
    // Deleting an already-missing object is a no-op, not a failure.
    if (isNotFound(error)) return;
    throw error;
  }
}

export async function downloadJsonFromStorage<T>(key: string): Promise<T> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getStorageConfig().bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Storage object has no body: ${key}`);
  }

  const text = await response.Body.transformToString();
  return JSON.parse(text) as T;
}

export async function downloadBytesFromStorage(
  key: string,
): Promise<Uint8Array> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getStorageConfig().bucket,
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error(`Storage object has no body: ${key}`);
  }
  return response.Body.transformToByteArray();
}

export async function getStorageObject(
  key: string,
): Promise<StorageObjectStream | null> {
  try {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: getStorageConfig().bucket,
        Key: key,
      }),
    );

    if (!response.Body) return null;

    return {
      body: response.Body.transformToWebStream(),
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength,
      etag: response.ETag,
      lastModified: response.LastModified,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
