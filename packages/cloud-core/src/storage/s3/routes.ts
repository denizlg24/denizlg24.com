import { createHash } from "node:crypto";

import { Hono } from "hono";

import {
  assertPayloadHash,
  extractS3AccessKeyId,
  normalizeS3HeaderValue,
  verifyS3Request,
} from "./auth";
import type { ResolvedS3Credential, S3CredentialProvider } from "./credentials";
import { escapeXml, S3Error, s3ErrorResponse, xmlResponse } from "./errors";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  copyObject,
  createBucket,
  createMultipartUpload,
  deleteBucket,
  deleteObject,
  getObjectFile,
  getObjectMetadata,
  headBucket,
  initS3Store,
  listBuckets,
  listMultipartUploads,
  listObjects,
  listParts,
  putObject,
  type S3StoreConfig,
  uploadPart,
} from "./store";
import { parseCompletedParts, parseDeleteObjects } from "./xml";

const S3_XML_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";
const MAX_CONTROL_BODY_BYTES = 2 * 1024 * 1024;

export interface S3ApiConfig extends S3StoreConfig {
  credentials: S3CredentialProvider;
}

interface S3Target {
  bucket?: string;
  key?: string;
}

function decodeTarget(url: URL): S3Target {
  const relative = url.pathname.slice("/v2".length).replace(/^\//, "");
  if (!relative) return {};
  const separator = relative.indexOf("/");
  try {
    if (separator < 0) {
      return { bucket: decodeURIComponent(relative) };
    }
    const bucket = decodeURIComponent(relative.slice(0, separator));
    const key = decodeURIComponent(relative.slice(separator + 1));
    return key ? { bucket, key } : { bucket };
  } catch {
    throw new S3Error(
      "InvalidURI",
      "Could not parse the specified URI.",
      400,
      url.pathname,
    );
  }
}

function requireAllowedBucket(
  credential: ResolvedS3Credential,
  bucket: string,
): void {
  if (
    credential.allowedBucket !== null &&
    credential.allowedBucket !== bucket
  ) {
    throw new S3Error("AccessDenied", "Access Denied.", 403, bucket);
  }
}

function parseInteger(
  value: string | null,
  name: string,
  fallback?: number,
): number | undefined {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new S3Error(
      "InvalidArgument",
      `${name} must be a non-negative integer.`,
      400,
    );
  }
  return Number.parseInt(value, 10);
}

async function readVerifiedBody(request: Request): Promise<string> {
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (declaredLength > MAX_CONTROL_BODY_BYTES) {
    throw new S3Error(
      "EntityTooLarge",
      "The request body exceeds the allowed size.",
      413,
    );
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CONTROL_BODY_BYTES) {
        await reader.cancel();
        throw new S3Error(
          "EntityTooLarge",
          "The request body exceeds the allowed size.",
          413,
        );
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes,
  );
  assertPayloadHash(
    request.headers.get("x-amz-content-sha256"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) !== totalBytes) {
    throw new S3Error(
      "IncompleteBody",
      "The request body terminated before the declared content length.",
      400,
    );
  }
  return bytes.toString("utf8");
}

function encodeS3Key(value: string, encodingType: string | null): string {
  if (encodingType !== "url") return escapeXml(value);
  return escapeXml(
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  );
}

function listBucketsResponse(
  accessKeyId: string,
  buckets: Awaited<ReturnType<typeof listBuckets>>,
): Response {
  const bucketXml = buckets
    .map(
      (bucket) =>
        `<Bucket><Name>${escapeXml(bucket.name)}</Name><CreationDate>${escapeXml(bucket.creationDate)}</CreationDate></Bucket>`,
    )
    .join("");
  return xmlResponse(
    `<ListAllMyBucketsResult xmlns="${S3_XML_NAMESPACE}"><Owner><ID>${escapeXml(accessKeyId)}</ID><DisplayName>deniz-cloud</DisplayName></Owner><Buckets>${bucketXml}</Buckets></ListAllMyBucketsResult>`,
  );
}

async function listObjectsResponse(
  config: S3ApiConfig,
  bucket: string,
  url: URL,
): Promise<Response> {
  const prefix = url.searchParams.get("prefix") ?? "";
  const delimiter = url.searchParams.get("delimiter") ?? undefined;
  const maxKeys = parseInteger(
    url.searchParams.get("max-keys"),
    "max-keys",
    1000,
  );
  const continuationToken =
    url.searchParams.get("continuation-token") ?? undefined;
  const startAfter = url.searchParams.get("start-after") ?? undefined;
  const encodingType = url.searchParams.get("encoding-type");
  if (encodingType && encodingType !== "url") {
    throw new S3Error("InvalidArgument", "encoding-type must be 'url'.", 400);
  }
  const result = await listObjects(config, bucket, {
    prefix,
    delimiter,
    maxKeys,
    continuationToken,
    startAfter,
  });
  const contents = result.objects
    .map(
      (object) =>
        `<Contents><Key>${encodeS3Key(object.key, encodingType)}</Key><LastModified>${escapeXml(object.lastModified)}</LastModified><ETag>&quot;${escapeXml(object.etag)}&quot;</ETag><Size>${object.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join("");
  const commonPrefixes = result.commonPrefixes
    .map(
      (prefixValue) =>
        `<CommonPrefixes><Prefix>${encodeS3Key(prefixValue, encodingType)}</Prefix></CommonPrefixes>`,
    )
    .join("");
  const tokenXml = continuationToken
    ? `<ContinuationToken>${escapeXml(continuationToken)}</ContinuationToken>`
    : "";
  const nextTokenXml = result.nextContinuationToken
    ? `<NextContinuationToken>${escapeXml(result.nextContinuationToken)}</NextContinuationToken>`
    : "";
  const delimiterXml = delimiter
    ? `<Delimiter>${encodeS3Key(delimiter, encodingType)}</Delimiter>`
    : "";
  const encodingXml = encodingType
    ? `<EncodingType>${encodingType}</EncodingType>`
    : "";
  const startAfterXml = startAfter
    ? `<StartAfter>${encodeS3Key(startAfter, encodingType)}</StartAfter>`
    : "";
  return xmlResponse(
    `<ListBucketResult xmlns="${S3_XML_NAMESPACE}"><Name>${escapeXml(bucket)}</Name><Prefix>${encodeS3Key(prefix, encodingType)}</Prefix>${delimiterXml}${encodingXml}<KeyCount>${result.keyCount}</KeyCount><MaxKeys>${result.maxKeys}</MaxKeys><IsTruncated>${result.isTruncated}</IsTruncated>${tokenXml}${nextTokenXml}${startAfterXml}${contents}${commonPrefixes}</ListBucketResult>`,
  );
}

function objectHeaders(
  metadata: Awaited<ReturnType<typeof getObjectMetadata>>,
): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(metadata.size),
    "Content-Type": metadata.contentType,
    ETag: `"${metadata.etag}"`,
    "Last-Modified": new Date(metadata.lastModified).toUTCString(),
  });
  for (const [name, value] of Object.entries(metadata.headers)) {
    if (isSafeHeaderValue(value)) {
      headers.set(name, value);
    }
  }
  return headers;
}

function isSafeHeaderValue(value: string): boolean {
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code === 0x09 || (code >= 0x20 && code <= 0x7e);
  });
}

function applyResponseOverrides(headers: Headers, url: URL): void {
  const overrides: Record<string, string> = {
    "response-cache-control": "Cache-Control",
    "response-content-disposition": "Content-Disposition",
    "response-content-encoding": "Content-Encoding",
    "response-content-language": "Content-Language",
    "response-content-type": "Content-Type",
    "response-expires": "Expires",
  };
  for (const [parameter, header] of Object.entries(overrides)) {
    const value = url.searchParams.get(parameter);
    if (value && isSafeHeaderValue(value)) {
      headers.set(header, value);
    }
  }
}

function checkConditions(
  request: Request,
  etag: string,
  lastModified: string,
): Response | undefined {
  const quotedEtag = `"${etag}"`;
  const ifMatch = request.headers.get("if-match");
  if (
    ifMatch &&
    ifMatch !== "*" &&
    !ifMatch
      .split(",")
      .map((value) => value.trim())
      .includes(quotedEtag)
  ) {
    return new Response(null, { status: 412 });
  }
  const ifNoneMatch = request.headers.get("if-none-match");
  if (
    ifNoneMatch &&
    (ifNoneMatch === "*" ||
      ifNoneMatch
        .split(",")
        .map((value) => value.trim())
        .includes(quotedEtag))
  ) {
    return new Response(null, {
      status: request.method === "GET" || request.method === "HEAD" ? 304 : 412,
    });
  }
  const modifiedSince = request.headers.get("if-modified-since");
  if (modifiedSince && new Date(lastModified) <= new Date(modifiedSince)) {
    return new Response(null, { status: 304 });
  }
  const unmodifiedSince = request.headers.get("if-unmodified-since");
  if (unmodifiedSince && new Date(lastModified) > new Date(unmodifiedSince)) {
    return new Response(null, { status: 412 });
  }
  return undefined;
}

async function getObjectResponse(
  config: S3ApiConfig,
  bucket: string,
  key: string,
  request: Request,
  url: URL,
): Promise<Response> {
  const metadata = await getObjectMetadata(config, bucket, key);
  const conditional = checkConditions(
    request,
    metadata.etag,
    metadata.lastModified,
  );
  if (conditional) return conditional;
  const headers = objectHeaders(metadata);
  applyResponseOverrides(headers, url);
  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }
  const file = getObjectFile(config, bucket, key);
  const range = request.headers.get("range");
  if (!range) return new Response(file, { headers });
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) {
    throw new S3Error(
      "InvalidRange",
      "The requested range is not satisfiable.",
      416,
      key,
    );
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2] ?? "", 10);
    if (suffixLength <= 0) {
      throw new S3Error(
        "InvalidRange",
        "The requested range is not satisfiable.",
        416,
        key,
      );
    }
    start = Math.max(0, metadata.size - suffixLength);
    end = metadata.size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : metadata.size - 1;
  }
  if (start >= metadata.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${metadata.size}` },
    });
  }
  end = Math.min(end, metadata.size - 1);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
  return new Response(file.slice(start, end + 1).stream(), {
    status: 206,
    headers,
  });
}

function parseCopySource(value: string): { bucket: string; key: string } {
  try {
    const normalized = normalizeS3HeaderValue(value);
    const decoded = decodeURIComponent(normalized.split("?")[0] ?? "").replace(
      /^\//,
      "",
    );
    const separator = decoded.indexOf("/");
    if (separator <= 0 || separator === decoded.length - 1) {
      throw new Error("invalid");
    }
    return {
      bucket: decoded.slice(0, separator),
      key: decoded.slice(separator + 1),
    };
  } catch {
    throw new S3Error("InvalidArgument", "x-amz-copy-source is invalid.", 400);
  }
}

async function deleteObjectsResponse(
  config: S3ApiConfig,
  bucket: string,
  request: Request,
): Promise<Response> {
  const { keys, quiet } = parseDeleteObjects(await readVerifiedBody(request));
  if (keys.length > 1000) {
    throw new S3Error(
      "MalformedXML",
      "A maximum of 1000 keys can be deleted per request.",
      400,
    );
  }
  const results = await Promise.allSettled(
    keys.map((key) => deleteObject(config, bucket, key)),
  );
  // S3 DeleteObjects never fails the batch on individual keys: each key gets
  // a <Deleted> or <Error> entry; quiet mode omits only the <Deleted> ones.
  const body = results
    .map((result, index) => {
      const key = keys[index] ?? "";
      if (result.status === "fulfilled") {
        return quiet ? "" : `<Deleted><Key>${escapeXml(key)}</Key></Deleted>`;
      }
      const error =
        result.reason instanceof S3Error
          ? result.reason
          : new S3Error(
              "InternalError",
              "We encountered an internal error.",
              500,
            );
      return `<Error><Key>${escapeXml(key)}</Key><Code>${escapeXml(error.code)}</Code><Message>${escapeXml(error.message)}</Message></Error>`;
    })
    .join("");
  return xmlResponse(
    `<DeleteResult xmlns="${S3_XML_NAMESPACE}">${body}</DeleteResult>`,
  );
}

async function multipartUploadsResponse(
  config: S3ApiConfig,
  bucket: string,
  accessKeyId: string,
): Promise<Response> {
  const uploads = await listMultipartUploads(config, bucket);
  const items = uploads
    .map(
      (upload) =>
        `<Upload><Key>${escapeXml(upload.key)}</Key><UploadId>${escapeXml(upload.uploadId)}</UploadId><Initiator><ID>${escapeXml(accessKeyId)}</ID><DisplayName>deniz-cloud</DisplayName></Initiator><Owner><ID>${escapeXml(accessKeyId)}</ID><DisplayName>deniz-cloud</DisplayName></Owner><StorageClass>STANDARD</StorageClass><Initiated>${escapeXml(upload.initiated)}</Initiated></Upload>`,
    )
    .join("");
  return xmlResponse(
    `<ListMultipartUploadsResult xmlns="${S3_XML_NAMESPACE}"><Bucket>${escapeXml(bucket)}</Bucket><KeyMarker></KeyMarker><UploadIdMarker></UploadIdMarker><NextKeyMarker></NextKeyMarker><NextUploadIdMarker></NextUploadIdMarker><Delimiter></Delimiter><Prefix></Prefix><EncodingType></EncodingType><MaxUploads>1000</MaxUploads><IsTruncated>false</IsTruncated>${items}</ListMultipartUploadsResult>`,
  );
}

async function dispatchS3(
  config: S3ApiConfig,
  credential: ResolvedS3Credential,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const { bucket, key } = decodeTarget(url);
  const method = request.method.toUpperCase();
  if (!bucket) {
    if (method === "GET") {
      const buckets = await listBuckets(config);
      return listBucketsResponse(
        credential.accessKeyId,
        credential.allowedBucket === null
          ? buckets
          : buckets.filter((item) => item.name === credential.allowedBucket),
      );
    }
    throw new S3Error(
      "MethodNotAllowed",
      "The specified method is not allowed against this resource.",
      405,
    );
  }
  requireAllowedBucket(credential, bucket);
  if (!key) {
    if (method === "PUT") {
      await readVerifiedBody(request);
      await createBucket(config, bucket);
      return new Response(null, {
        status: 200,
        headers: { Location: `/v2/${bucket}` },
      });
    }
    if (method === "HEAD") {
      await headBucket(config, bucket);
      return new Response(null, {
        headers: { "x-amz-bucket-region": config.region },
      });
    }
    if (method === "DELETE") {
      await deleteBucket(config, bucket);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.searchParams.has("delete")) {
      return deleteObjectsResponse(config, bucket, request);
    }
    if (method === "GET" && url.searchParams.has("uploads")) {
      return multipartUploadsResponse(config, bucket, credential.accessKeyId);
    }
    if (method === "GET") {
      return listObjectsResponse(config, bucket, url);
    }
    throw new S3Error(
      "MethodNotAllowed",
      "The specified method is not allowed against this resource.",
      405,
      bucket,
    );
  }

  const uploadId = url.searchParams.get("uploadId");
  if (method === "POST" && url.searchParams.has("uploads")) {
    const upload = await createMultipartUpload(config, bucket, key, request);
    return xmlResponse(
      `<InitiateMultipartUploadResult xmlns="${S3_XML_NAMESPACE}"><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${upload.uploadId}</UploadId></InitiateMultipartUploadResult>`,
    );
  }
  if (method === "PUT" && uploadId && url.searchParams.has("partNumber")) {
    const part = await uploadPart(
      config,
      bucket,
      key,
      uploadId,
      parseInteger(url.searchParams.get("partNumber"), "partNumber") ?? 0,
      request,
    );
    return new Response(null, { headers: { ETag: `"${part.etag}"` } });
  }
  if (method === "GET" && uploadId) {
    const result = await listParts(config, bucket, key, uploadId);
    const parts = result.parts
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><LastModified>${escapeXml(part.lastModified)}</LastModified><ETag>&quot;${part.etag}&quot;</ETag><Size>${part.size}</Size></Part>`,
      )
      .join("");
    return xmlResponse(
      `<ListPartsResult xmlns="${S3_XML_NAMESPACE}"><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${escapeXml(uploadId)}</UploadId><PartNumberMarker>0</PartNumberMarker><NextPartNumberMarker>0</NextPartNumberMarker><MaxParts>1000</MaxParts><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`,
    );
  }
  if (method === "POST" && uploadId) {
    const metadata = await completeMultipartUpload(
      config,
      bucket,
      key,
      uploadId,
      parseCompletedParts(await readVerifiedBody(request)),
    );
    return xmlResponse(
      `<CompleteMultipartUploadResult xmlns="${S3_XML_NAMESPACE}"><Location>/v2/${escapeXml(bucket)}/${escapeXml(key)}</Location><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><ETag>&quot;${metadata.etag}&quot;</ETag></CompleteMultipartUploadResult>`,
    );
  }
  if (method === "DELETE" && uploadId) {
    await abortMultipartUpload(config, bucket, key, uploadId);
    return new Response(null, { status: 204 });
  }
  if (method === "PUT") {
    const copySource = request.headers.get("x-amz-copy-source");
    if (copySource) {
      const source = parseCopySource(copySource);
      requireAllowedBucket(credential, source.bucket);
      const metadata = await copyObject(
        config,
        source.bucket,
        source.key,
        bucket,
        key,
        request,
      );
      return xmlResponse(
        `<CopyObjectResult><LastModified>${escapeXml(metadata.lastModified)}</LastModified><ETag>&quot;${metadata.etag}&quot;</ETag></CopyObjectResult>`,
      );
    }
    const metadata = await putObject(config, bucket, key, request);
    return new Response(null, {
      headers: { ETag: `"${metadata.etag}"` },
    });
  }
  if (method === "GET" || method === "HEAD") {
    return getObjectResponse(config, bucket, key, request, url);
  }
  if (method === "DELETE") {
    await deleteObject(config, bucket, key);
    return new Response(null, { status: 204 });
  }
  throw new S3Error(
    "MethodNotAllowed",
    "The specified method is not allowed against this resource.",
    405,
    key,
  );
}

export async function initializeS3(config: S3ApiConfig): Promise<void> {
  await initS3Store(config);
}

async function handleS3Request(
  config: S3ApiConfig,
  request: Request,
): Promise<Response> {
  const requestId = crypto.randomUUID().replaceAll("-", "");
  let response: Response;
  try {
    const accessKeyId = extractS3AccessKeyId(request);
    const credential = await config.credentials.resolve(accessKeyId);
    if (!credential) {
      throw new S3Error(
        "InvalidAccessKeyId",
        "The AWS access key ID you provided does not exist.",
        403,
      );
    }
    verifyS3Request(request, credential, config.region);
    config.credentials.markUsed(credential.id);
    response = await dispatchS3(config, credential, request);
  } catch (error) {
    if (error instanceof S3Error) {
      response = s3ErrorResponse(error, requestId);
    } else {
      console.error("S3 request failed", error);
      response = s3ErrorResponse(
        new S3Error(
          "InternalError",
          "We encountered an internal error. Please try again.",
          500,
        ),
        requestId,
      );
    }
  }
  response.headers.set("x-amz-request-id", requestId);
  response.headers.set("x-amz-bucket-region", config.region);
  return response;
}

export function s3Routes(config: S3ApiConfig): Hono {
  const router = new Hono();
  router.all("/", (context) => handleS3Request(config, context.req.raw));
  router.all("/*", (context) => handleS3Request(config, context.req.raw));
  return router;
}
