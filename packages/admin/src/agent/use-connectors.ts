"use client";

import {
  type Connector,
  type ConnectorList,
  PRIMARY_CONNECTOR_SLUG,
} from "@repo/schemas";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "../provider";

/** Primary connector first, then by name. */
export function sortConnectors(connectors: Connector[]): Connector[] {
  const unique = new Map<string, Connector>();
  for (const connector of connectors) {
    const current = unique.get(connector.slug);
    if (!current) {
      unique.set(connector.slug, connector);
      continue;
    }
    const score = (entry: Connector) =>
      Number(entry.builtIn) * 1_000_000 +
      Number(entry.status === "ready") * 100_000 +
      entry.toolCount * 10 +
      new Date(entry.updatedAt).getTime() / 1e13;
    if (score(connector) > score(current)) {
      unique.set(connector.slug, connector);
    }
  }

  return [...unique.values()].sort((left, right) => {
    if (left.slug === PRIMARY_CONNECTOR_SLUG) return -1;
    if (right.slug === PRIMARY_CONNECTOR_SLUG) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function useConnectors({
  refreshOnFocus = false,
}: {
  refreshOnFocus?: boolean;
} = {}) {
  const { client } = useAdmin();
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await client.get<ConnectorList>("connectors");
      setConnectors(sortConnectors(result.connectors));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load connectors",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshOnFocus) return;
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, refreshOnFocus]);

  const replace = useCallback((next: Connector) => {
    setConnectors((current) =>
      current
        ? sortConnectors(
            current.some((entry) => entry.id === next.id)
              ? current.map((entry) => (entry.id === next.id ? next : entry))
              : [...current, next],
          )
        : [next],
    );
  }, []);

  const drop = useCallback((id: string) => {
    setConnectors(
      (current) => current?.filter((entry) => entry.id !== id) ?? null,
    );
  }, []);

  return { connectors, loading, error, refresh, replace, drop };
}
