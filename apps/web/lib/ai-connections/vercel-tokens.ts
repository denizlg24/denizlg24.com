import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import { AiConnection, type IAiConnection } from "@/models/AiConnection";
import { AiConnectionError } from "./errors";
import { GATEWAY_ID, readGateway } from "./store";
import { requireVercelOAuthConfig } from "./vercel-config";

const tokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  refresh_token: z.string().min(1).max(16384),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  id_token: z.string().optional(),
});

export async function exchangeVercelToken(parameters: Record<string, string>) {
  const config = requireVercelOAuthConfig();
  try {
    const response = await fetch("https://api.vercel.com/login/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        ...parameters,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Token exchange rejected");
    return tokenSchema.parse(await response.json());
  } catch {
    throw new AiConnectionError(
      "oauth_token",
      "Vercel token exchange failed. Reconnect Vercel.",
      502,
    );
  }
}

const reconnect = () =>
  new AiConnectionError(
    "oauth_reconnect",
    "Vercel authorization expired or refresh was interrupted. Reconnect Vercel.",
    401,
  );

export async function oauthAccessToken(
  initial: IAiConnection,
): Promise<string> {
  let current: IAiConnection | null = initial;
  const deadline = Date.now() + 14000;
  while (current?.source === "oauth" && current.revision === initial.revision) {
    if (
      current.apiKey &&
      current.accessExpiresAt &&
      current.accessExpiresAt.getTime() > Date.now() + 60000
    ) {
      return decryptSecret(current.apiKey);
    }
    if (current.refreshOwner) {
      if (
        !current.refreshStartedAt ||
        Date.now() - current.refreshStartedAt.getTime() > 30000
      )
        throw reconnect();
      if (Date.now() >= deadline)
        throw new AiConnectionError(
          "refresh_busy",
          "Vercel credential refresh is in progress. Try again.",
          503,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = await readGateway();
      continue;
    }
    if (!current.refreshToken) throw reconnect();
    const owner = randomUUID();
    // Consume the refresh token in the same atomic operation as the claim. No lease
    // takeover can replay a single-use token after a crash or ambiguous network failure.
    const claimed = await AiConnection.findOneAndUpdate(
      {
        _id: GATEWAY_ID,
        revision: current.revision,
        refreshOwner: { $exists: false },
        refreshToken: { $exists: true },
      },
      {
        $set: { refreshOwner: owner, refreshStartedAt: new Date() },
        $unset: { refreshToken: 1 },
      },
      { returnDocument: "before" },
    )
      .lean<IAiConnection>()
      .exec();
    if (!claimed?.refreshToken) {
      current = await readGateway();
      continue;
    }
    const filter = {
      _id: GATEWAY_ID,
      revision: claimed.revision,
      refreshOwner: owner,
    };
    try {
      const tokens = await exchangeVercelToken({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(claimed.refreshToken),
      });
      const saved = await AiConnection.updateOne(filter, {
        $set: {
          apiKey: encryptSecret(tokens.access_token),
          refreshToken: encryptSecret(tokens.refresh_token),
          accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
        $unset: { refreshOwner: 1, refreshStartedAt: 1 },
      });
      if (saved.matchedCount !== 1) throw reconnect();
      return tokens.access_token;
    } catch {
      await AiConnection.updateOne(filter, {
        $set: { status: "error", lastError: reconnect().message },
        $unset: { refreshOwner: 1, refreshStartedAt: 1, apiKey: 1 },
      });
      throw reconnect();
    }
  }
  throw new AiConnectionError(
    "connection_changed",
    "Gateway connection changed. Try again.",
    409,
  );
}
