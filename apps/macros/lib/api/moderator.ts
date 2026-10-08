import {
  bearerToken,
  type CloudAccessToken,
  createAccessTokenVerifier,
  isSuperuserToken,
  looksLikeJwt,
} from "@repo/cloud-auth-client/resource";
import { CLOUD_AUTH_ISSUER, OAUTH_RESOURCES } from "@repo/schemas/cloud";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

let verifier: ((token: string) => Promise<CloudAccessToken | null>) | null =
  null;

function verify(token: string) {
  verifier ??= createAccessTokenVerifier({
    issuer: process.env.MACROS_OAUTH_ISSUER ?? CLOUD_AUTH_ISSUER,
    audience: process.env.MACROS_OAUTH_RESOURCE ?? OAUTH_RESOURCES.macros,
  });
  return verifier(token);
}

/**
 * The moderation console's gate: a deniz auth access token for this API that
 * belongs to a superuser. Macros' own accounts never reach `/api/admin/*`.
 * `actor` is the token subject and is what the audit log records.
 */
export async function requireModerator(): Promise<
  { actor: string; response: null } | { actor: null; response: NextResponse }
> {
  const token = bearerToken((await headers()).get("authorization"));
  if (!token || !looksLikeJwt(token)) {
    return {
      actor: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let verified: CloudAccessToken | null;
  try {
    verified = await verify(token);
  } catch {
    return {
      actor: null,
      response: NextResponse.json(
        { error: "Sign-in is unavailable" },
        { status: 503 },
      ),
    };
  }

  if (!verified) {
    return {
      actor: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (verified.machine || !isSuperuserToken(verified)) {
    return {
      actor: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { actor: verified.subject, response: null };
}
