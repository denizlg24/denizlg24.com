import { AiConnectionError } from "./errors";

export function vercelOAuthConfig() {
  const clientId = process.env.VERCEL_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET?.trim();
  const redirectUri = process.env.VERCEL_APP_REDIRECT_URI?.trim();
  // This flag asserts that this app has the private-beta team AI Gateway Use permission.
  // openid/profile/email scopes alone do not grant Gateway access.
  if (
    process.env.VERCEL_APP_GATEWAY_ENABLED !== "true" ||
    !clientId ||
    !clientSecret ||
    !redirectUri
  )
    return null;
  try {
    const url = new URL(redirectUri);
    if (
      (url.protocol !== "https:" &&
        !(
          process.env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          url.hostname === "localhost"
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/admin/ai-connections/vercel/callback"
    )
      return null;
    return { clientId, clientSecret, redirectUri };
  } catch {
    return null;
  }
}

export function requireVercelOAuthConfig() {
  const config = vercelOAuthConfig();
  if (!config)
    throw new AiConnectionError(
      "oauth_unavailable",
      "Vercel OAuth with AI Gateway Use permission is not configured.",
      503,
    );
  return config;
}
