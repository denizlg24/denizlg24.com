import {
  AUTH_APP_URL,
  CLOUD_AUTH_ISSUER,
  DEV_AUTH_APP_URL,
  DEV_CLOUD_AUTH_ISSUER,
  OAUTH_RESOURCES,
} from "@repo/schemas/cloud";
import { DEV_STREAM_RESOURCE, STREAM_RESOURCE } from "@repo/schemas/stream";

const isDev = process.env.NODE_ENV !== "production";

export function streamBaseUrl(): string {
  return (
    process.env.STREAM_URL ?? (isDev ? DEV_STREAM_RESOURCE : STREAM_RESOURCE)
  ).replace(/\/$/, "");
}

export function streamResource(): string {
  return process.env.STREAM_RESOURCE ?? streamBaseUrl();
}

export function authIssuer(): string {
  return (
    process.env.DENIZ_AUTH_ISSUER ??
    (isDev ? DEV_CLOUD_AUTH_ISSUER : CLOUD_AUTH_ISSUER)
  ).replace(/\/$/, "");
}

/** The deniz auth tenant whose members may use Stream. */
export function streamTenant(): string | null {
  return process.env.STREAM_TENANT_ID || null;
}

export function ownerSubject(): string | null {
  return process.env.STREAM_OWNER_SUBJECT || null;
}

export function webUrl(): string {
  return (process.env.STREAM_WEB_URL ?? OAUTH_RESOURCES.web).replace(/\/$/, "");
}

export function minVotes(): number {
  return Number(process.env.STREAM_MIN_VOTES ?? 1000);
}

export function authAppUrl(): string {
  return (
    process.env.AUTH_APP_URL ?? (isDev ? DEV_AUTH_APP_URL : AUTH_APP_URL)
  ).replace(/\/$/, "");
}
