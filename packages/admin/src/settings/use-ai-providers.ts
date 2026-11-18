"use client";

import type {
  AiConnectionsResponse,
  AiProvidersResponse,
  AiSubscriptionsResponse,
  LlmCatalogModel,
} from "@repo/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_PROVIDER_CHANGED } from "../agent/provider-models";
import { useAdmin } from "../provider";
import {
  getAiConnections,
  getAiProviders,
  getAiSubscriptions,
} from "./ai-connections-api";

export interface AiProvidersState {
  subscriptions: AiSubscriptionsResponse | null;
  connections: AiConnectionsResponse | null;
  /** Slower than the rest: listing Claude's models starts its runtime. */
  providers: AiProvidersResponse | null;
  loading: boolean;
  providersLoading: boolean;
  failed: boolean;
  /** Every connected provider's models, Gateway first. */
  models: LlmCatalogModel[];
  reload: () => Promise<void>;
}

export function useAiProviders(): AiProvidersState {
  const { client } = useAdmin();
  const [subscriptions, setSubscriptions] =
    useState<AiSubscriptionsResponse | null>(null);
  const [connections, setConnections] = useState<AiConnectionsResponse | null>(
    null,
  );
  const [providers, setProviders] = useState<AiProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setFailed(false);
    setProvidersLoading(true);
    const listing = getAiProviders(client)
      .then((next) => {
        if (request === generation.current) setProviders(next);
      })
      .catch(() => {
        if (request === generation.current) setProviders(null);
      })
      .finally(() => {
        if (request === generation.current) setProvidersLoading(false);
      });
    try {
      const [nextSubscriptions, nextConnections] = await Promise.all([
        getAiSubscriptions(client),
        getAiConnections(client),
      ]);
      if (request !== generation.current) return;
      setSubscriptions(nextSubscriptions);
      setConnections(nextConnections);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
    await listing;
  }, [client]);

  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener(AI_PROVIDER_CHANGED, refresh);
    return () => {
      generation.current++;
      window.removeEventListener(AI_PROVIDER_CHANGED, refresh);
    };
  }, [reload]);

  const models = useMemo(
    () =>
      (providers?.providers ?? [])
        .filter((entry) => entry.connected)
        .flatMap((entry) => entry.models),
    [providers],
  );

  return {
    subscriptions,
    connections,
    providers,
    loading,
    providersLoading,
    failed,
    models,
    reload,
  };
}
