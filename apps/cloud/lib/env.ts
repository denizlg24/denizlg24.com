import { API_BASE_URL } from "@repo/cloud-ui/api-client";

export { API_BASE_URL };

// NEXT_PUBLIC_* values are inlined at build time. Fall back to the local dev
// services, never to production: a build that forgot the Vercel variables
// should break loudly instead of pointing this admin app at live infrastructure.
export const STORAGE_APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "http://localhost:3005";

const DEFAULT_DISK_BAY_COUNT = 12;
const configuredDiskBayCount = Number(process.env.NEXT_PUBLIC_DISK_BAY_COUNT);

// This value is public because it controls the client-rendered rack layout.
// Keep malformed Vercel values from producing an unusable page.
export const DISK_BAY_COUNT =
  Number.isInteger(configuredDiskBayCount) &&
  configuredDiskBayCount >= 1 &&
  configuredDiskBayCount <= 128
    ? configuredDiskBayCount
    : DEFAULT_DISK_BAY_COUNT;

export function apiWsUrl(path: string): string {
  const url = new URL(path, API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
