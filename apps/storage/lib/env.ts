// NEXT_PUBLIC_* values are inlined at build time. The fallbacks are the local
// dev services and never production: a deploy that forgot its Vercel variables
// ends up pointing at an unreachable localhost, which is obvious, rather than
// silently reading and writing real users' files.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "http://localhost:3001";

export const APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "http://localhost:3005";

export function apiUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}
