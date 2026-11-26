import { currentUser, json, sameOrigin } from "@/lib/auth";
import { mintRelayToken, relayConfig } from "@/lib/relay-token";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (!(await currentUser()))
    return json({ error: "Sign in to stream quotes." }, 401);
  const config = relayConfig();
  if (!config) return json({ error: "Live quotes are not configured." }, 503);
  return json({ ...mintRelayToken(config.secret), url: config.url });
}
