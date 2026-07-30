"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { useEffect, useState } from "react";
import { useAdmin } from "../provider";

export type CatalogModel = { id: string; name: string };

const DEFAULT_SENTINEL = "__default__";

export function useModelCatalog(requiredCapability?: string) {
  const { client } = useAdmin();
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const query = requiredCapability
      ? `llm/models?requiredCapability=${encodeURIComponent(requiredCapability)}`
      : "llm/models";
    (async () => {
      try {
        const raw = await client.get<{
          models?: { id: string; name: string; tags?: string[] }[];
        }>(query);
        if (!cancelled) setModels(raw.models ?? []);
      } catch {
        // Catalog cold or unreachable — the free-form value still renders.
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, requiredCapability]);

  return { models, modelsLoading };
}

/**
 * Picks a Gateway model id, with `null` meaning "fall back to the server
 * default". A stored id that is missing from the catalog stays selectable so a
 * cold or filtered catalog cannot silently reset the setting.
 */
export function ModelSelect({
  value,
  onChange,
  models,
  defaultLabel,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  models: CatalogModel[];
  defaultLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const known = value !== null && models.some((model) => model.id === value);

  return (
    <Select
      value={value ?? DEFAULT_SENTINEL}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === DEFAULT_SENTINEL ? null : next)
      }
    >
      <SelectTrigger className={className ?? "h-8 w-full max-w-md text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL} className="text-xs">
          {defaultLabel}
        </SelectItem>
        {value !== null && !known && (
          <SelectItem value={value} className="text-xs">
            {value} (current)
          </SelectItem>
        )}
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            {model.name} · {model.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
