import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { codeChallenge } from "../core/pkce.js";
import type { FetchLike } from "../core/tokens.js";

export const ISSUER = "https://issuer.test/api/auth";

interface Client {
  secret?: string;
  tenant?: string;
}

interface PendingCode {
  sub: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
}

interface Grant {
  sub: string;
  clientId: string;
  resource: string;
}

export interface FakeIssuer {
  fetch: FetchLike;
  keys: JWTVerifyGetKey;
  calls: { token: number; revoke: number };
  revoked: Set<string>;
  /** What the server would do between the authorize redirect and the callback. */
  authorize(authorizationUrl: string, sub: string): Promise<string>;
  mint(input: {
    sub: string;
    clientId: string;
    audience: string;
    ttl?: number;
    tenant?: string;
  }): Promise<string>;
  /** Make the next n token requests fail at the network level. */
  failNetwork(times: number): void;
  /** Make the next token request answer a gateway error page. */
  failGateway(): void;
  /** Make every token request wait for this before answering. */
  hold(promise: Promise<void> | null): void;
  accessTtl: number;
}

export async function createFakeIssuer(
  clients: Record<string, Client>,
): Promise<FakeIssuer> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "EdDSA" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Map<string, Grant>();
  const revoked = new Set<string>();
  const calls = { token: 0, revoke: 0 };
  let networkFailures = 0;
  let gatewayFailure = false;
  let held: Promise<void> | null = null;
  let counter = 0;

  const issuer: FakeIssuer = {
    keys,
    calls,
    revoked,
    accessTtl: 900,

    async mint({ sub, clientId, audience, ttl, tenant }) {
      const claims: Record<string, unknown> = {
        azp: clientId,
        scope: "openid offline_access",
      };
      if (tenant) claims.tenant = tenant;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: "k1" })
        .setIssuer(ISSUER)
        .setAudience(audience)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime(
          Math.floor(Date.now() / 1000) + (ttl ?? issuer.accessTtl),
        )
        .sign(privateKey);
    },

    async authorize(authorizationUrl, sub) {
      const url = new URL(authorizationUrl);
      const params = url.searchParams;
      const code = `code-${++counter}`;
      codes.set(code, {
        sub,
        clientId: params.get("client_id") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        challenge: params.get("code_challenge") ?? "",
        resource: params.get("resource") ?? "",
      });
      const callback = new URL(params.get("redirect_uri") ?? "");
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", params.get("state") ?? "");
      callback.searchParams.set("iss", ISSUER);
      return callback.toString();
    },

    failNetwork(times) {
      networkFailures = times;
    },
    failGateway() {
      gatewayFailure = true;
    },
    hold(promise) {
      held = promise;
    },

    fetch: async (input, init) => {
      const url = new URL(input);
      const body = new URLSearchParams(String(init.body ?? ""));
      const headers = new Headers(init.headers);
      if (url.pathname.endsWith("/oauth2/revoke")) {
        calls.revoke++;
        const token = body.get("token");
        if (token) {
          revoked.add(token);
          refreshTokens.delete(token);
        }
        return new Response(null, { status: 200 });
      }
      if (!url.pathname.endsWith("/oauth2/token")) {
        return new Response("not found", { status: 404 });
      }
      calls.token++;
      if (held) await held;
      if (networkFailures > 0) {
        networkFailures--;
        throw new TypeError("fetch failed");
      }
      if (gatewayFailure) {
        gatewayFailure = false;
        return new Response("<html>502</html>", { status: 502 });
      }

      let clientId = body.get("client_id");
      const authorization = headers.get("authorization");
      if (authorization?.startsWith("Basic ")) {
        const [id, secret] = atob(authorization.slice(6))
          .split(":")
          .map(decodeURIComponent);
        if (!id || clients[id]?.secret !== secret)
          return oauthError(401, "invalid_client");
        clientId = id;
      } else if (!clientId || !clients[clientId] || clients[clientId]?.secret) {
        return oauthError(401, "invalid_client");
      }
      const client = clients[clientId];
      if (!client) return oauthError(401, "invalid_client");

      const issue = async (grant: Grant, withRefresh: boolean) => {
        const refresh = withRefresh ? `rt-${++counter}` : undefined;
        if (refresh) refreshTokens.set(refresh, grant);
        return Response.json({
          access_token: await issuer.mint({
            sub: grant.sub,
            clientId: grant.clientId,
            audience: grant.resource,
            tenant: client.tenant,
          }),
          token_type: "Bearer",
          expires_in: issuer.accessTtl,
          refresh_token: refresh,
        });
      };

      switch (body.get("grant_type")) {
        case "authorization_code": {
          const pending = codes.get(body.get("code") ?? "");
          codes.delete(body.get("code") ?? "");
          if (
            !pending ||
            pending.clientId !== clientId ||
            pending.redirectUri !== body.get("redirect_uri") ||
            pending.challenge !==
              (await codeChallenge(body.get("code_verifier") ?? ""))
          ) {
            return oauthError(400, "invalid_grant");
          }
          return issue(
            { sub: pending.sub, clientId, resource: pending.resource },
            true,
          );
        }
        case "refresh_token": {
          const token = body.get("refresh_token") ?? "";
          const grant = refreshTokens.get(token);
          if (!grant || grant.clientId !== clientId)
            return oauthError(400, "invalid_grant");
          refreshTokens.delete(token);
          return issue(grant, true);
        }
        case "client_credentials":
          return issue(
            { sub: clientId, clientId, resource: body.get("resource") ?? "" },
            false,
          );
        default:
          return oauthError(400, "unsupported_grant_type");
      }
    },
  };
  return issuer;
}

function oauthError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
