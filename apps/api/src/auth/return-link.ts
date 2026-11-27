const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the auth app may send someone back to after they manage their account
 * from inside a tenant's app: a page on an origin the client already
 * registered a redirect URI on. The client proved it controls that origin when
 * its developer registered it, so linking back hands nobody anything an
 * authorization would not. Plain http only ever passes for a loopback origin
 * the client registered itself (local development).
 */
export function registeredReturnUrl(
  value: string,
  redirectUris: readonly string[],
): string | null {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.username || target.password) return null;
  const loopback = LOOPBACK_HOSTS.has(target.hostname);
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && loopback)
  ) {
    return null;
  }
  const origins = new Set<string>();
  for (const uri of redirectUris) {
    try {
      const registered = new URL(uri);
      if (registered.protocol === "https:" || registered.protocol === "http:") {
        origins.add(registered.origin);
      }
    } catch {
      // A malformed registration matches nothing.
    }
  }
  return origins.has(target.origin) ? target.toString() : null;
}
