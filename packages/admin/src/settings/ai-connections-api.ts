import type {
  AiConnectionsResponse,
  AiSubscriptionsResponse,
  ChatgptCredential,
  ChatgptModelsResponse,
  DisconnectAiSubscriptionResponse,
  SaveAiSubscription,
} from "@repo/schemas";
import { notifyAiProviderChanged } from "../agent/provider-models";
import type { AdminClient, AdminRequestOptions } from "../client";

export type {
  AiConnectionsResponse,
  AiSubscriptionsResponse,
  SaveAiSubscription,
} from "@repo/schemas";

export function getAiConnections(
  client: AdminClient,
  options?: AdminRequestOptions,
) {
  return client.get<AiConnectionsResponse>("ai-connections", options);
}

export function saveGatewayConnection(
  client: AdminClient,
  input: { apiKey: string; teamIdOrSlug?: string },
) {
  return client.put("ai-connections/gateway", input);
}

export function disconnectGateway(client: AdminClient) {
  return client.del("ai-connections/gateway");
}

export function testGatewayConnection(client: AdminClient) {
  return client.post("ai-connections/gateway/test");
}

export function authorizeVercel(client: AdminClient, teamIdOrSlug: string) {
  const query = new URLSearchParams();
  if (teamIdOrSlug.trim()) query.set("teamIdOrSlug", teamIdOrSlug.trim());
  const suffix = query.size ? `?${query}` : "";
  if (!client.endpointUrl) throw new Error("Browser authorization unavailable");
  return client.endpointUrl(`ai-connections/vercel/authorize${suffix}`);
}

export function getAiSubscriptions(
  client: AdminClient,
  options?: AdminRequestOptions,
) {
  return client.get<AiSubscriptionsResponse>("ai-subscriptions", options);
}

export async function saveAiSubscription(
  client: AdminClient,
  input: SaveAiSubscription,
) {
  const result = await client.put("ai-subscriptions", input);
  notifyAiProviderChanged();
  return result;
}

export async function disconnectAiSubscription(
  client: AdminClient,
  provider: "chatgpt" | "claude-code",
) {
  const result = await client.del<DisconnectAiSubscriptionResponse>(
    `ai-subscriptions?provider=${provider}`,
  );
  notifyAiProviderChanged();
  return result;
}

export function getChatgptModels(
  client: AdminClient,
  credentials?: ChatgptCredential,
) {
  return client.post<ChatgptModelsResponse>(
    "ai-subscriptions/chatgpt-models",
    credentials ? { credentials } : {},
  );
}
