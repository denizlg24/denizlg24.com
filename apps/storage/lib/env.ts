// NEXT_PUBLIC_* values are inlined at build time. The fallbacks are the local
// dev services and never production: a deploy that forgot its Vercel variables
// ends up pointing at an unreachable localhost, which is obvious, rather than
// silently reading and writing real users' files.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "http://localhost:3001";

export const APP_URL =
  process.env.NEXT_PUBLIC_STORAGE_APP_URL ?? "http://localhost:3005";

/**
 * The SMB host, which is a tailnet address rather than the public API domain:
 * TCP 445 is never exposed off the tailnet. The fallback is deliberately
 * unroutable so a deploy missing the variable produces a mount that plainly
 * fails instead of one that points somewhere real.
 */
export const SMB_HOST =
  process.env.NEXT_PUBLIC_SMB_HOST ?? "smb-host-not-configured";

export function apiUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}
