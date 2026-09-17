/** Where the visitor is on the way to, as the flow states it. */
export interface Destination {
  /** "Forge", "Claude", or the bare host when nothing better is known. */
  name: string;
  /** Shown after the name when it adds information; null when it would repeat it. */
  host: string | null;
  /**
   * Set when the destination is an OAuth authorization request: the page can
   * resolve the client's public name and replace `name` with it.
   */
  clientId?: string;
}

const APP_NAMES: Record<string, string> = {
  "denizlg24.com": "denizlg24.com",
  "www.denizlg24.com": "denizlg24.com",
  "forge.denizlg24.com": "Forge",
  "cloud.denizlg24.com": "Cloud",
  "storage.denizlg24.com": "Storage",
  "status.denizlg24.com": "Status",
  "auth.denizlg24.com": "your account",
  "mcp.denizlg24.com": "MCP",
  "api.denizlg24.com": "the API",
};

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

export const ACCOUNT_DESTINATION: Destination = {
  name: "your account",
  host: null,
};

/**
 * Reads the destination off a `returnTo` URL. Known hosts get their app name;
 * an authorize URL (what the consent page's "sign out" hands back) is named
 * after its client; anything else is named by its host.
 */
export function destinationFromUrl(value: string | null): Destination | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  const clientId = url.searchParams.get("client_id");
  if (url.pathname === AUTHORIZE_PATH && clientId) {
    return { name: clientId, host: null, clientId };
  }
  const name = APP_NAMES[url.hostname.toLowerCase()];
  if (!name) return { name: host, host: null };
  return { name, host: name === host ? null : host };
}

/** Names an OAuth client from its public metadata, falling back to its id. */
export function destinationFromClient(
  clientId: string,
  client: { client_name?: string; client_uri?: string } | null,
): Destination {
  const name = client?.client_name?.trim() || clientId;
  let host: string | null = null;
  if (client?.client_uri) {
    try {
      host = new URL(client.client_uri).host;
    } catch {
      host = null;
    }
  }
  return { name, host: host && host !== name ? host : null, clientId };
}
