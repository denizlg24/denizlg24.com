import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { S3Error } from "./errors";

const ALGORITHM = "AWS4-HMAC-SHA256";
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1_000;
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export interface S3SigningCredential {
  accessKeyId: string;
  secretAccessKey: string;
}

interface SignatureFields {
  credential: string;
  signedHeaders: string;
  signature: string;
  requestDate: string;
  payloadHash: string;
  presigned: boolean;
  expiresSeconds?: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(pathname: string): string {
  try {
    return pathname
      .split("/")
      .map((segment) => awsEncode(decodeURIComponent(segment)))
      .join("/");
  } catch {
    throw new S3Error(
      "InvalidURI",
      "Could not parse the specified URI.",
      400,
      pathname,
    );
  }
}

function canonicalQuery(url: URL, presigned: boolean): string {
  return [...url.searchParams.entries()]
    .filter(
      ([name]) => !(presigned && name.toLowerCase() === "x-amz-signature"),
    )
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName !== rightName) {
        return leftName < rightName ? -1 : 1;
      }
      if (leftValue === rightValue) {
        return 0;
      }
      return leftValue < rightValue ? -1 : 1;
    })
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

export function normalizeS3HeaderValue(value: string): string {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

function parseAuthorization(request: Request, url: URL): SignatureFields {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(
      /^AWS4-HMAC-SHA256\s+Credential=([^,\s]+),\s*SignedHeaders=([^,\s]+),\s*Signature=([0-9a-fA-F]{64})$/,
    );
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new S3Error(
        "AuthorizationHeaderMalformed",
        "The authorization header is malformed.",
        400,
      );
    }
    const requestDate = request.headers.get("x-amz-date");
    if (!requestDate) {
      throw new S3Error(
        "AccessDenied",
        "AWS authentication requires a valid x-amz-date header.",
        403,
      );
    }
    const payloadHash = request.headers.get("x-amz-content-sha256");
    if (!payloadHash) {
      throw new S3Error(
        "AccessDenied",
        "AWS Signature Version 4 requires the x-amz-content-sha256 header.",
        403,
      );
    }
    return {
      credential: match[1],
      signedHeaders: match[2],
      signature: match[3].toLowerCase(),
      requestDate,
      payloadHash,
      presigned: false,
    };
  }

  const algorithm = url.searchParams.get("X-Amz-Algorithm");
  const credential = url.searchParams.get("X-Amz-Credential");
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders");
  const signature = url.searchParams.get("X-Amz-Signature");
  const requestDate = url.searchParams.get("X-Amz-Date");
  const expires = url.searchParams.get("X-Amz-Expires");
  if (!algorithm && !credential && !signature) {
    throw new S3Error("AccessDenied", "AWS authentication is required.", 403);
  }
  if (
    algorithm !== ALGORITHM ||
    !credential ||
    !signedHeaders ||
    !signature?.match(/^[0-9a-fA-F]{64}$/) ||
    !requestDate ||
    !expires
  ) {
    throw new S3Error(
      "AuthorizationQueryParametersError",
      "The query-string authentication parameters are malformed.",
      400,
    );
  }
  const expiresSeconds = Number.parseInt(expires, 10);
  if (
    !Number.isInteger(expiresSeconds) ||
    expiresSeconds < 1 ||
    expiresSeconds > MAX_PRESIGN_SECONDS
  ) {
    throw new S3Error(
      "AuthorizationQueryParametersError",
      "X-Amz-Expires must be between 1 and 604800 seconds.",
      400,
    );
  }
  return {
    credential,
    signedHeaders,
    signature: signature.toLowerCase(),
    requestDate,
    payloadHash: "UNSIGNED-PAYLOAD",
    presigned: true,
    expiresSeconds,
  };
}

function parseAmzDate(value: string): Date {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    throw new S3Error("AccessDenied", "The request date is invalid.", 403);
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new S3Error("AccessDenied", "The request date is invalid.", 403);
  }
  return date;
}

function validateTime(fields: SignatureFields, now: Date): void {
  const requestTime = parseAmzDate(fields.requestDate).getTime();
  const nowTime = now.getTime();
  if (fields.presigned) {
    const expiresAt = requestTime + (fields.expiresSeconds ?? 0) * 1_000;
    if (nowTime < requestTime - MAX_CLOCK_SKEW_MS || nowTime > expiresAt) {
      throw new S3Error("AccessDenied", "Request has expired.", 403);
    }
    return;
  }
  if (Math.abs(nowTime - requestTime) > MAX_CLOCK_SKEW_MS) {
    throw new S3Error(
      "RequestTimeTooSkewed",
      "The difference between the request time and the server time is too large.",
      403,
    );
  }
}

function canonicalHeaders(
  request: Request,
  signedHeadersValue: string,
  url: URL,
): string {
  const signedHeaders = signedHeadersValue.split(";");
  const sorted = [...new Set(signedHeaders)].sort();
  if (
    signedHeaders.join(";") !== sorted.join(";") ||
    !signedHeaders.includes("host")
  ) {
    throw new S3Error(
      "AuthorizationHeaderMalformed",
      "Signed headers must be lowercase, sorted, unique, and include host.",
      400,
    );
  }
  return signedHeaders
    .map((name) => {
      if (name !== name.toLowerCase()) {
        throw new S3Error(
          "AuthorizationHeaderMalformed",
          "Signed header names must be lowercase.",
          400,
        );
      }
      const value =
        name === "host"
          ? (request.headers.get("host") ?? url.host)
          : request.headers.get(name);
      if (value === null) {
        throw new S3Error(
          "SignatureDoesNotMatch",
          `Signed header ${name} is missing.`,
          403,
        );
      }
      return `${name}:${normalizeS3HeaderValue(value).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
}

export function assertPayloadHash(
  expected: string | null,
  actual: string,
): void {
  if (!expected || expected === "UNSIGNED-PAYLOAD") {
    return;
  }
  if (expected.startsWith("STREAMING-")) {
    throw new S3Error(
      "NotImplemented",
      "AWS chunked payload signing is not supported; use multipart upload or UNSIGNED-PAYLOAD.",
      501,
    );
  }
  if (
    !expected.match(/^[0-9a-fA-F]{64}$/) ||
    expected.toLowerCase() !== actual.toLowerCase()
  ) {
    throw new S3Error(
      "XAmzContentSHA256Mismatch",
      "The provided x-amz-content-sha256 does not match the request body.",
      400,
    );
  }
}

export function requestPayloadHash(request: Request): string | null {
  return request.headers.get("x-amz-content-sha256");
}

export function extractS3AccessKeyId(request: Request): string {
  const fields = parseAuthorization(request, new URL(request.url));
  const accessKeyId = fields.credential.split("/")[0];
  if (!accessKeyId) {
    throw new S3Error(
      "AuthorizationHeaderMalformed",
      "The credential scope is malformed.",
      400,
    );
  }
  return accessKeyId;
}

export function verifyS3Request(
  request: Request,
  credential: S3SigningCredential,
  region: string,
  now = new Date(),
): void {
  const url = new URL(request.url);
  const fields = parseAuthorization(request, url);
  validateTime(fields, now);
  const scope = fields.credential.split("/");
  const [accessKeyId, date, credentialRegion, service, terminator] = scope;
  if (scope.length !== 5 || !accessKeyId || !date || !credentialRegion) {
    throw new S3Error(
      "AuthorizationHeaderMalformed",
      "The credential scope is malformed.",
      400,
    );
  }
  if (accessKeyId !== credential.accessKeyId) {
    throw new S3Error(
      "InvalidAccessKeyId",
      "The AWS access key ID you provided does not exist.",
      403,
    );
  }
  if (
    credentialRegion !== region ||
    service !== "s3" ||
    terminator !== "aws4_request"
  ) {
    throw new S3Error(
      "AuthorizationHeaderMalformed",
      `The authorization scope must use region '${region}' and service 's3'.`,
      400,
    );
  }
  if (date !== fields.requestDate.slice(0, 8)) {
    throw new S3Error(
      "AuthorizationHeaderMalformed",
      "The credential date does not match x-amz-date.",
      400,
    );
  }

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url, fields.presigned),
    canonicalHeaders(request, fields.signedHeaders, url),
    fields.signedHeaders,
    fields.payloadHash,
  ].join("\n");
  const credentialScope = `${date}/${credentialRegion}/s3/aws4_request`;
  const stringToSign = `${ALGORITHM}\n${fields.requestDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${credential.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, credentialRegion);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const expected = hmac(signingKey, stringToSign);
  const actual = Buffer.from(fields.signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new S3Error(
      "SignatureDoesNotMatch",
      "The request signature we calculated does not match the signature you provided.",
      403,
    );
  }
}
