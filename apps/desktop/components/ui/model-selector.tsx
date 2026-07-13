"use client";

import { Button } from "@repo/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@repo/ui/combobox";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import type { LlmCatalogModel } from "@/lib/data-types";
import { cn } from "@/lib/utils";

// Searchable model picker fed by the Gateway catalog (via the web API).
// Models are grouped by creator and filtered down to the capabilities the
// current chat features require. There is no hardcoded model list.

const CAPABILITY_BADGES: Record<string, string> = {
  "tool-use": "tools",
  "web-search": "web",
  reasoning: "reasoning",
};

function formatContext(contextWindow?: number): string | null {
  if (!contextWindow) return null;
  return contextWindow >= 1_000_000
    ? `${Math.round(contextWindow / 1_000_000)}M ctx`
    : `${Math.round(contextWindow / 1000)}K ctx`;
}

interface CreatorGroup {
  label: string;
  items: LlmCatalogModel[];
}

export const ModelSelector = ({
  model,
  onModelChange,
  models,
  loading,
  error,
  stale,
  onRetry,
  requiredCapabilities = [],
  className,
}: {
  /** Currently selected fully qualified Gateway model id (or null). */
  model: string | null;
  onModelChange: (model: string) => void;
  models: LlmCatalogModel[] | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
  requiredCapabilities?: string[];
  className?: string;
}) => {
  const eligible = useMemo(
    () =>
      (models ?? []).filter((entry) =>
        requiredCapabilities.every((tag) => entry.tags.includes(tag)),
      ),
    [models, requiredCapabilities],
  );

  const groups = useMemo<CreatorGroup[]>(() => {
    const byCreator = new Map<string, LlmCatalogModel[]>();
    for (const entry of eligible) {
      const bucket = byCreator.get(entry.creator);
      if (bucket) {
        bucket.push(entry);
      } else {
        byCreator.set(entry.creator, [entry]);
      }
    }
    return [...byCreator.entries()].map(([label, items]) => ({
      label,
      items,
    }));
  }, [eligible]);

  const selected = useMemo(
    () => models?.find((entry) => entry.id === model) ?? null,
    [models, model],
  );
  const incompatible =
    selected !== null &&
    !requiredCapabilities.every((tag) => selected.tags.includes(tag));

  // Discovery failed with nothing cached: keep the raw id visible and offer
  // a retry — never a hardcoded fallback list.
  if (error && !models) {
    return (
      <div className={cn("w-full flex flex-col gap-2", className)}>
        <p className="text-xs text-muted-foreground truncate">
          {model ?? "No model selected"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">Couldn't load models</p>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw className="w-3 h-3" /> Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full flex flex-col gap-2", className)}>
      <Combobox
        items={groups}
        value={selected}
        onValueChange={(value: LlmCatalogModel | null) => {
          if (value) onModelChange(value.id);
        }}
        itemToStringLabel={(entry: LlmCatalogModel) => entry.name}
        isItemEqualToValue={(left: LlmCatalogModel, right: LlmCatalogModel) =>
          left.id === right.id
        }
        filter={(entry: LlmCatalogModel, query: string) => {
          const q = query.toLowerCase();
          return (
            entry.name.toLowerCase().includes(q) ||
            entry.id.toLowerCase().includes(q) ||
            entry.creator.toLowerCase().includes(q)
          );
        }}
      >
        <ComboboxInput
          placeholder={loading ? "Loading models…" : "Search models"}
          disabled={loading}
          className="w-full"
        />
        <ComboboxContent>
          <ComboboxEmpty>No matching models.</ComboboxEmpty>
          <ComboboxList>
            {(group: CreatorGroup) => (
              <ComboboxGroup key={group.label} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(entry: LlmCatalogModel) => (
                    <ComboboxItem key={entry.id} value={entry}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{entry.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {[
                            formatContext(entry.contextWindow),
                            ...entry.tags
                              .filter((tag) => CAPABILITY_BADGES[tag])
                              .map((tag) => CAPABILITY_BADGES[tag]),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {incompatible && (
        <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 w-3 h-3 shrink-0" />
          This model doesn't support the enabled features. Pick a compatible
          model or change the toggles.
        </p>
      )}
      {!incompatible && error && models && (
        <p className="text-xs text-muted-foreground">
          Model list may be outdated.{" "}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Retry
            </button>
          )}
        </p>
      )}
      {!incompatible && !error && stale && (
        <p className="text-xs text-muted-foreground">
          Model list may be outdated.
        </p>
      )}
    </div>
  );
};
