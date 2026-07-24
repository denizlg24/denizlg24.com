// NEXT_PUBLIC_* values are inlined at build time. Fall back to the local dev
// services, never to production: a build that forgot the Vercel variables
// should break loudly instead of pointing this app at live user files.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "http://localhost:3001";

export const APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "http://localhost:3005";

export function apiUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}
