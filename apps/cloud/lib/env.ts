export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "https://api.denizlg24.com";

export const STORAGE_APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "https://storage.denizlg24.com";

export function apiWsUrl(path: string): string {
  const url = new URL(path, API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
