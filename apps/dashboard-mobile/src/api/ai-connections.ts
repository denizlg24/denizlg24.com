import type {
  AiConnectionsResponse,
  AiProvidersResponse,
  AiSubscriptionsResponse,
  DisconnectAiSubscriptionResponse,
  GatewayConnectionInput,
  SaveAiSubscription,
} from "@repo/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const aiConnectionsKey = ["ai-connections"] as const;
export const aiSubscriptionsKey = ["ai-subscriptions"] as const;
export const aiProvidersKey = ["llm-providers"] as const;

export function useAiProviders() {
  return useQuery({
    queryKey: aiProvidersKey,
    queryFn: ({ signal }) =>
      api.request<AiProvidersResponse>("llm/providers", { signal }),
  });
}

export function useAiConnections() {
  return useQuery({
    queryKey: aiConnectionsKey,
    queryFn: ({ signal }) =>
      api.request<AiConnectionsResponse>("ai-connections", { signal }),
  });
}

export function useAiSubscriptions() {
  return useQuery({
    queryKey: aiSubscriptionsKey,
    queryFn: ({ signal }) =>
      api.request<AiSubscriptionsResponse>("ai-subscriptions", { signal }),
  });
}

// Credentials go directly to the authenticated client, never mutation caches.
export function saveGateway(input: GatewayConnectionInput) {
  return api.request<AiConnectionsResponse>("ai-connections/gateway", {
    method: "PUT",
    body: input,
  });
}

export function disconnectGateway() {
  return api.request<AiConnectionsResponse>("ai-connections/gateway", {
    method: "DELETE",
  });
}

export function testGateway() {
  return api.request<AiConnectionsResponse>("ai-connections/gateway/test", {
    method: "POST",
  });
}

export function saveSubscription(input: SaveAiSubscription) {
  return api.request<AiSubscriptionsResponse>("ai-subscriptions", {
    method: "PUT",
    body: input,
  });
}

export function disconnectSubscription(provider: "chatgpt" | "claude-code") {
  return api.request<DisconnectAiSubscriptionResponse>("ai-subscriptions", {
    method: "DELETE",
    query: { provider },
  });
}
