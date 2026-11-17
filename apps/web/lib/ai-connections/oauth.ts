import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import { connectDB } from "@/lib/mongodb";
import { AiConnection, type IAiConnection } from "@/models/AiConnection";
import { AiConnectionError } from "./errors";
import { verifyGatewayCredential } from "./gateway";
import { GATEWAY_ID, readGateway } from "./store";
import { requireVercelOAuthConfig } from "./vercel-config";
import { exchangeVercelToken } from "./vercel-tokens";

export const VERCEL_FLOW_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-gateway-vercel-flow"
    : "gateway-vercel-flow";
export const vercelFlowCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};
const jwks = createRemoteJWKSet(new URL("https://vercel.com/.well-known/jwks"));
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const flowSchema = z.object({
  verifier: z.string(),
  nonce: z.string(),
  teamIdOrSlug: z.string().optional(),
  revision: z.string().nullable(),
});
const invalidFlow = () =>
  new AiConnectionError(
    "oauth_state",
    "Vercel authorization session is invalid or expired. Start again.",
    400,
  );

/** Bind to the exact authenticated browser session as well as its verified principal. */
export function oauthSessionHash(cookie: string, principal: string) {
  return hash(`${principal}\0${cookie}`);
}

export async function beginVercelOAuth(
  sessionHash: string,
  teamIdOrSlug?: string,
) {
  const config = requireVercelOAuthConfig();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const current = await readGateway();
  await AiConnection.create({
    _id: `vercel-flow:${hash(state)}`,
    revision: randomUUID(),
    sessionHash,
    expiresAt: new Date(Date.now() + 600000),
    flow: encryptSecret(
      JSON.stringify({
        verifier,
        nonce,
        teamIdOrSlug,
        revision: current?.revision ?? null,
      }),
    ),
  });
  const url = new URL("https://vercel.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid offline_access",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  return { state, url: url.toString() };
}

export async function completeVercelOAuth(input: {
  state: string;
  cookieState: string;
  code: string;
  sessionHash: string;
}) {
  const config = requireVercelOAuthConfig();
  if (
    !input.state ||
    input.state.length > 128 ||
    input.state !== input.cookieState ||
    !input.code ||
    input.code.length > 8192
  )
    throw invalidFlow();
  await connectDB();
  // Consume state before exchange: concurrent callbacks cannot exchange the same code.
  const stored = await AiConnection.findOneAndDelete({
    _id: `vercel-flow:${hash(input.state)}`,
    sessionHash: input.sessionHash,
    expiresAt: { $gt: new Date() },
  })
    .lean<IAiConnection>()
    .exec();
  if (!stored?.flow) throw invalidFlow();
  let flow: z.infer<typeof flowSchema>;
  try {
    flow = flowSchema.parse(JSON.parse(decryptSecret(stored.flow)));
  } catch {
    throw invalidFlow();
  }
  const tokens = await exchangeVercelToken({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: flow.verifier,
    redirect_uri: config.redirectUri,
  });
  try {
    if (!tokens.id_token) throw invalidFlow();
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: "https://vercel.com",
      audience: config.clientId,
      algorithms: ["RS256"],
    });
    if (payload.nonce !== flow.nonce || typeof payload.sub !== "string")
      throw invalidFlow();
  } catch {
    throw invalidFlow();
  }
  // Identity scopes are insufficient: authenticate an actual Gateway read for the selected team.
  await verifyGatewayCredential({
    apiKey: tokens.access_token,
    teamIdOrSlug: flow.teamIdOrSlug,
  });
  const replacement: IAiConnection = {
    _id: GATEWAY_ID,
    revision: randomUUID(),
    source: "oauth",
    status: "connected",
    apiKey: encryptSecret(tokens.access_token),
    refreshToken: encryptSecret(tokens.refresh_token),
    accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    teamIdOrSlug: flow.teamIdOrSlug,
  };
  try {
    const saved = await AiConnection.replaceOne(
      { _id: GATEWAY_ID, revision: flow.revision ?? { $exists: false } },
      replacement,
      { upsert: flow.revision === null },
    );
    if (saved.matchedCount !== 1 && saved.upsertedCount !== 1)
      throw invalidFlow();
  } catch {
    throw new AiConnectionError(
      "connection_changed",
      "Gateway connection changed during authorization. Start again.",
      409,
    );
  }
}
