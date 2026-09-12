import { API_BASE_URL } from "@repo/cloud-ui/api-client";

/** Parameters the authorization server adds when it signs a redirect. */
const SIGNING_PARAMS = new Set(["sig", "exp", "ba_iat", "ba_pl", "ba_param"]);

/**
 * The authorization server sends the browser here with its original request
 * signed into the query; an ordinary sign-in (from cloud, forge, storage) has
 * only a `returnTo`.
 */
export function isAuthorizationRedirect(params: URLSearchParams): boolean {
  return params.has("sig") && params.has("client_id");
}

/**
 * Rebuilds the authorize request the server interrupted, so the browser can
 * start it again now that a session exists. Used only where the provider's own
 * resume did not run — after TOTP enrollment, whose client deliberately does
 * not carry the signed query. `prompt=login` is dropped the same way the
 * provider drops it, or the request would send the browser straight back here.
 */
export function authorizeUrl(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (SIGNING_PARAMS.has(key)) continue;
    if (key === "prompt") {
      const remaining = value
        .split(" ")
        .filter((prompt) => prompt && prompt !== "login")
        .join(" ");
      if (remaining) query.append(key, remaining);
      continue;
    }
    query.append(key, value);
  }
  return new URL(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    API_BASE_URL,
  ).toString();
}

export function isProviderRedirect(
  data: unknown,
): data is { redirect: true; url: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "redirect" in data &&
    data.redirect === true &&
    "url" in data &&
    typeof data.url === "string"
  );
}
