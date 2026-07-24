export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "https://api.denizlg24.com";

export const STORAGE_APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "https://storage.denizlg24.com";

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
