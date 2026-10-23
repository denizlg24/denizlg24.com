/** The contract this client build understands, independent of its app version. */
export const MACROS_API_VERSION = "v1";

/** Pin feature requests; auth, public assets and explicitly versioned URLs stay put. */
export function versionedMacrosApiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (
    !normalized.startsWith("/api/") ||
    /^\/api\/(?:auth|v\d+)(?:\/|[?#]|$)/.test(normalized)
  ) {
    return normalized;
  }
  return `/api/${MACROS_API_VERSION}${normalized.slice(4)}`;
}
