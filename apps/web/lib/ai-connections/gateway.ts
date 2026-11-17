import { createGateway } from "@ai-sdk/gateway";
import type {
  AiConnectionsResponse,
  GatewayConnectionInput,
} from "@repo/schemas";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import type { IAiConnection } from "@/models/AiConnection";
import { AiConnectionError, gatewayFailure } from "./errors";
import { readGateway, recordGatewayTest, replaceGateway } from "./store";
import { vercelOAuthConfig } from "./vercel-config";
import { oauthAccessToken } from "./vercel-tokens";

export interface GatewayCredential {
  apiKey: string;
  teamIdOrSlug?: string;
  source: "stored" | "environment" | "oauth";
}

export async function resolveGatewayCredential(
  stored: IAiConnection | null,
): Promise<GatewayCredential> {
  if (stored && !stored.disconnected) {
    try {
      if (stored.source !== "stored" && stored.source !== "oauth")
        throw new Error("Invalid source");
      const apiKey =
        stored.source === "oauth"
          ? await oauthAccessToken(stored)
          : stored.apiKey
            ? decryptSecret(stored.apiKey)
            : "";
      if (!apiKey) throw new Error("Missing credential");
      return {
        apiKey,
        source: stored.source,
        ...(stored.teamIdOrSlug ? { teamIdOrSlug: stored.teamIdOrSlug } : {}),
      };
    } catch (error) {
      if (error instanceof AiConnectionError) throw error;
      throw new AiConnectionError(
        "stored_credential",
        "Stored Gateway credential cannot be read. Replace it or reconnect.",
        503,
      );
    }
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey)
    throw new AiConnectionError(
      "not_configured",
      "Gateway is not configured.",
      409,
    );
  const teamIdOrSlug = process.env.AI_GATEWAY_TEAM_ID?.trim();
  return {
    apiKey,
    source: "environment",
    ...(teamIdOrSlug ? { teamIdOrSlug } : {}),
  };
}

export async function getGatewayCredential(): Promise<GatewayCredential> {
  return resolveGatewayCredential(await readGateway());
}

export async function verifyGatewayCredential(
  credential: Pick<GatewayCredential, "apiKey" | "teamIdOrSlug">,
) {
  try {
    await createGateway({
      ...credential,
      // A credits read authenticates without generating tokens or spending inference credits.
      fetch: Object.assign(
        (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          }),
        { preconnect: fetch.preconnect },
      ),
    }).getCredits();
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    throw gatewayFailure(status);
  }
}

export async function configureGateway(input: GatewayConnectionInput) {
  // Encrypt before network I/O to fail early when the encryption key is unavailable.
  let apiKey: ReturnType<typeof encryptSecret>;
  try {
    apiKey = encryptSecret(input.apiKey);
  } catch {
    throw new AiConnectionError(
      "encryption",
      "Server secret encryption is not configured.",
      503,
    );
  }
  await verifyGatewayCredential(input);
  await replaceGateway({
    source: "stored",
    apiKey,
    teamIdOrSlug: input.teamIdOrSlug,
    status: "connected",
  });
}

export async function getAiConnections(): Promise<AiConnectionsResponse> {
  const stored = await readGateway();
  const environment = Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
  const gateway: AiConnectionsResponse["gateway"] =
    stored && !stored.disconnected
      ? {
          configured: true,
          source: stored.source ?? null,
          status: stored.status ?? "unverified",
          ...(stored.teamIdOrSlug ? { teamIdOrSlug: stored.teamIdOrSlug } : {}),
          ...(stored.lastError ? { lastError: stored.lastError } : {}),
        }
      : {
          configured: environment,
          source: environment ? "environment" : null,
          status: environment ? "unverified" : "disconnected",
          ...(environment && process.env.AI_GATEWAY_TEAM_ID?.trim()
            ? { teamIdOrSlug: process.env.AI_GATEWAY_TEAM_ID.trim() }
            : {}),
        };
  if (
    stored?.source === "oauth" &&
    stored.accessExpiresAt &&
    stored.accessExpiresAt.getTime() <= Date.now() &&
    !stored.refreshToken &&
    (!stored.refreshOwner ||
      !stored.refreshStartedAt ||
      Date.now() - stored.refreshStartedAt.getTime() > 30000)
  ) {
    gateway.status = "error";
    gateway.lastError = "Vercel authorization requires reconnection.";
  }
  return { gateway, vercelOAuthAvailable: Boolean(vercelOAuthConfig()) };
}

export async function testGatewayConnection() {
  const stored = await readGateway();
  try {
    await verifyGatewayCredential(await resolveGatewayCredential(stored));
    if (stored) await recordGatewayTest(stored.revision);
  } catch (error) {
    if (stored)
      await recordGatewayTest(
        stored.revision,
        error instanceof AiConnectionError
          ? error.message
          : "Gateway verification failed.",
      );
    throw error;
  }
  const result = await getAiConnections();
  if (
    (!stored || stored.disconnected) &&
    result.gateway.source === "environment"
  )
    result.gateway.status = "connected";
  return result;
}
