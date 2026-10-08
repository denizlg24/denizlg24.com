/**
 * An APNs provider-token client for Node. Server-only: `@repo/utils/apns`
 * imports `node:http2` and `node:crypto`, which no browser bundle may pull.
 * Macros keeps its own copy (`apps/macros/lib/push`) from before this existed.
 */
import {
  createPrivateKey,
  type KeyObject,
  sign as signWithKey,
} from "node:crypto";
import { type ClientHttp2Session, connect, constants } from "node:http2";

export type ApnsEnvironment = "development" | "production";

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  privateKey: KeyObject;
}

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
};

const REQUEST_TIMEOUT_MS = 10_000;
// APNs refuses a token older than an hour and throttles one refreshed more
// often than every 20 minutes, so a cached token lives between the two.
const JWT_MAX_AGE_SECONDS = 50 * 60;

/** Environments hand a PEM over as one line with literal `\n` escapes. */
export function parseApnsPrivateKey(raw: string): KeyObject {
  return createPrivateKey({
    key: raw.replace(/\\n/g, "\n").trim(),
    format: "pem",
  });
}

/** ES256 with header `kid` and claims `iss`, `iat`; the signature is raw r‖s. */
export function buildApnsJwt(
  credentials: ApnsCredentials,
  issuedAtSeconds: number,
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "ES256", kid: credentials.keyId })}.${encode({ iss: credentials.teamId, iat: issuedAtSeconds })}`;
  const signature = signWithKey("sha256", Buffer.from(signingInput), {
    key: credentials.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export type ApnsOutcome = "sent" | "disable" | "refresh-token" | "failed";

const DEAD_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
]);

export function classifyApnsResponse(
  status: number,
  reason: string | null,
): ApnsOutcome {
  if (status === 200) return "sent";
  if (status === 410) return "disable";
  if (reason && DEAD_TOKEN_REASONS.has(reason)) return "disable";
  if (
    status === 403 &&
    (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")
  ) {
    return "refresh-token";
  }
  return "failed";
}

function readReason(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "reason" in parsed &&
      typeof parsed.reason === "string"
    ) {
      return parsed.reason;
    }
  } catch {}
  return null;
}

export interface ApnsRequest {
  environment: ApnsEnvironment;
  token: string;
  /** The bundle id, plus `.push-type.liveactivity` for an activity. */
  topic: string;
  pushType: "alert" | "background" | "liveactivity";
  priority: 5 | 10;
  payload: object;
  collapseId?: string;
  expiresInSeconds?: number;
}

export interface ApnsResult {
  outcome: ApnsOutcome;
  status: number;
  reason: string | null;
}

export interface ApnsClient {
  send(request: ApnsRequest): Promise<ApnsResult>;
  close(): void;
}

function post(
  session: ClientHttp2Session,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let status = 0;
    let data = "";
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });
    request.setEncoding("utf8");
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.close(constants.NGHTTP2_CANCEL);
    });
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS]);
    });
    request.on("data", (chunk: string) => {
      data += chunk;
    });
    request.on("end", () => {
      settled = true;
      resolve({ status, body: data });
    });
    for (const event of ["error", "close"] as const) {
      request.on(event, (error?: Error) => {
        if (settled) return;
        settled = true;
        reject(error ?? new Error("APNs request closed without a response"));
      });
    }
    request.end(body);
  });
}

/** One HTTP/2 connection per environment, opened on first use. */
export function createApnsClient(credentials: ApnsCredentials): ApnsClient {
  const sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
  let cached: { token: string; issuedAt: number } | null = null;

  const providerToken = () => {
    const now = Math.floor(Date.now() / 1000);
    if (!cached || now - cached.issuedAt >= JWT_MAX_AGE_SECONDS) {
      cached = { token: buildApnsJwt(credentials, now), issuedAt: now };
    }
    return cached.token;
  };

  const sessionFor = (environment: ApnsEnvironment) => {
    const existing = sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(HOSTS[environment]);
    session.on("error", (error) => {
      console.error(`[apns] ${environment} connection failed`, error);
    });
    session.on("close", () => {
      if (sessions.get(environment) === session) sessions.delete(environment);
    });
    sessions.set(environment, session);
    return session;
  };

  return {
    async send(request) {
      const body = JSON.stringify(request.payload);
      const attempt = () =>
        post(
          sessionFor(request.environment),
          `/3/device/${request.token}`,
          {
            authorization: `bearer ${providerToken()}`,
            "apns-topic": request.topic,
            "apns-push-type": request.pushType,
            "apns-priority": String(request.priority),
            "apns-expiration": String(
              Math.floor(Date.now() / 1000) +
                (request.expiresInSeconds ?? 60 * 60),
            ),
            ...(request.collapseId
              ? { "apns-collapse-id": request.collapseId }
              : {}),
            "content-type": "application/json",
          },
          body,
        );
      let response = await attempt();
      let reason = readReason(response.body);
      let outcome = classifyApnsResponse(response.status, reason);
      if (outcome === "refresh-token") {
        cached = null;
        response = await attempt();
        reason = readReason(response.body);
        outcome = classifyApnsResponse(response.status, reason);
      }
      return { outcome, status: response.status, reason };
    },
    close() {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
