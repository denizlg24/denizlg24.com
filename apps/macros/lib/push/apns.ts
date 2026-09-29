import { type ClientHttp2Session, connect, constants } from "node:http2";
import type { MacrosPushEnvironment } from "@repo/schemas/macros";
import { eq } from "drizzle-orm";

import { db } from "@/db/connection";
import { pushDevices } from "@/db/schema";
import { classifyApnsResponse, readApnsReason } from "./apns-outcome";
import {
  type ApnsCredentials,
  buildApnsJwt,
  type CachedJwt,
  isJwtFresh,
  parseApnsPrivateKey,
} from "./jwt";
import { buildApnsPayload, type PushMessage } from "./messages";

const DEFAULT_BUNDLE_ID = "com.denizlg24.macros";
const REQUEST_TIMEOUT_MS = 10_000;
const EXPIRATION_SECONDS = 6 * 60 * 60;

const HOSTS: Record<MacrosPushEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

type ApnsConfig = { credentials: ApnsCredentials; bundleId: string };

let config: ApnsConfig | null | undefined;
let cachedJwt: CachedJwt | null = null;

function readConfig(): ApnsConfig | null {
  if (config !== undefined) return config;
  const keyId = process.env.MACROS_APNS_KEY_ID?.trim();
  const teamId = process.env.MACROS_APNS_TEAM_ID?.trim();
  const rawKey = process.env.MACROS_APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !rawKey?.trim()) {
    config = null;
    return config;
  }
  try {
    config = {
      credentials: { keyId, teamId, privateKey: parseApnsPrivateKey(rawKey) },
      bundleId: process.env.MACROS_APNS_BUNDLE_ID?.trim() || DEFAULT_BUNDLE_ID,
    };
  } catch (error) {
    console.error("[push] MACROS_APNS_PRIVATE_KEY is not a valid key", error);
    config = null;
  }
  return config;
}

export function isPushConfigured(): boolean {
  return readConfig() !== null;
}

function providerToken(credentials: ApnsCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  if (isJwtFresh(cachedJwt, now)) return cachedJwt.token;
  cachedJwt = {
    token: buildApnsJwt(credentials, now),
    issuedAtSeconds: now,
  };
  return cachedJwt.token;
}

export type PushDevice = {
  id: string;
  token: string;
  environment: MacrosPushEnvironment;
  bundleId: string;
};

export type PushSendCounts = {
  sent: number;
  failed: number;
  disabled: number;
  /** Registered for a different app than this server pushes as. */
  skipped: number;
};

export type PushSender = {
  configured: boolean;
  send: (
    devices: readonly PushDevice[],
    message: PushMessage,
  ) => Promise<PushSendCounts>;
  close: () => void;
};

type ApnsResponse = { status: number; body: string };

function post(
  session: ClientHttp2Session,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<ApnsResponse> {
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
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.on("close", () => {
      if (settled) return;
      settled = true;
      reject(new Error("APNs request closed without a response"));
    });
    request.end(body);
  });
}

async function disableDevice(id: string) {
  await db
    .update(pushDevices)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(eq(pushDevices.id, id));
}

const EMPTY_COUNTS: PushSendCounts = {
  sent: 0,
  failed: 0,
  disabled: 0,
  skipped: 0,
};

/**
 * One HTTP/2 connection per APNs host, opened on first use and reused for
 * the whole run. Never throws: an unconfigured server sends nothing and a
 * failed device is counted, not raised.
 */
export function createPushSender(): PushSender {
  const apns = readConfig();
  if (!apns) {
    return {
      configured: false,
      send: async () => ({ ...EMPTY_COUNTS }),
      close: () => undefined,
    };
  }

  const { credentials, bundleId } = apns;
  const sessions = new Map<MacrosPushEnvironment, ClientHttp2Session>();

  function sessionFor(environment: MacrosPushEnvironment) {
    const existing = sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(HOSTS[environment]);
    session.on("error", (error) => {
      console.error(`[push] APNs ${environment} connection failed`, error);
    });
    session.on("close", () => {
      if (sessions.get(environment) === session) sessions.delete(environment);
    });
    sessions.set(environment, session);
    return session;
  }

  async function deliver(
    device: PushDevice,
    body: string,
    message: PushMessage,
  ) {
    const request = () =>
      post(
        sessionFor(device.environment),
        `/3/device/${device.token}`,
        {
          authorization: `bearer ${providerToken(credentials)}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-collapse-id": message.kind,
          "apns-expiration": String(
            Math.floor(Date.now() / 1000) + EXPIRATION_SECONDS,
          ),
          "content-type": "application/json",
        },
        body,
      );

    let response = await request();
    let outcome = classifyApnsResponse(
      response.status,
      readApnsReason(response.body),
    );
    if (outcome === "refresh-token") {
      cachedJwt = null;
      response = await request();
      outcome = classifyApnsResponse(
        response.status,
        readApnsReason(response.body),
      );
    }
    if (outcome !== "sent") {
      console.warn(
        `[push] APNs ${response.status} for device ${device.id}: ${response.body}`,
      );
    }
    return outcome;
  }

  return {
    configured: true,
    async send(devices, message) {
      const counts = { ...EMPTY_COUNTS };
      const body = JSON.stringify(buildApnsPayload(message));
      for (const device of devices) {
        if (device.bundleId !== bundleId) {
          counts.skipped += 1;
          continue;
        }
        try {
          const outcome = await deliver(device, body, message);
          if (outcome === "sent") counts.sent += 1;
          else if (outcome === "disable") {
            await disableDevice(device.id);
            counts.disabled += 1;
          } else counts.failed += 1;
        } catch (error) {
          console.error(`[push] sending to device ${device.id} failed`, error);
          counts.failed += 1;
        }
      }
      return counts;
    },
    close() {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
