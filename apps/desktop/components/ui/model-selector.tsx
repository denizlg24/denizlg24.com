"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import {
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LlmCatalogModel } from "@/lib/data-types";
import { cn } from "@/lib/utils";

// Dialog-backed model picker fed by the Gateway catalog (via the web API).
// Ordering heuristics are derived from catalog metadata only: no hardcoded
// model inventory and no provider-specific SDK assumptions.

const CAPABILITY_BADGES: Record<string, string> = {
  "tool-use": "tools",
  "web-search": "web",
  reasoning: "reasoning",
  "image-generation": "image",
  vision: "vision",
};

const POWER_KEYWORDS: Record<string, number> = {
  opus: 28,
  fable: 30,
  sonnet: 20,
  pro: 18,
  ultra: 18,
  max: 16,
  large: 14,
  haiku: 8,
  mini: 5,
  nano: 3,
  small: 3,
};

type SortMode = "recommended" | "recent" | "power" | "cost";

interface ModelView {
  model: LlmCatalogModel;
  compatible: boolean;
  powerScore: number;
  recencyScore: number;
  price: number;
}

interface CreatorGroup {
  label: string;
  items: ModelView[];
}

function formatContext(contextWindow?: number): string | null {
  if (!contextWindow) return null;
  return contextWindow >= 1_000_000
    ? `${Math.round(contextWindow / 1_000_000)}M ctx`
    : `${Math.round(contextWindow / 1000)}K ctx`;
}

function formatTokens(n?: number): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M out`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K out`;
  return `${n.toLocaleString()} out`;
}

function formatCreator(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPrice(model: LlmCatalogModel): string | null {
  const input = model.pricing?.input;
  const output = model.pricing?.output;
  if (input === undefined && output === undefined) return null;

  const inputPerMillion =
    input === undefined ? null : `$${(input * 1_000_000).toFixed(2)} in`;
  const outputPerMillion =
    output === undefined ? null : `$${(output * 1_000_000).toFixed(2)} out`;
  return [inputPerMillion, outputPerMillion].filter(Boolean).join(" / ");
}

function getCapabilityLabel(tag: string): string {
  return CAPABILITY_BADGES[tag] ?? tag.replaceAll("-", " ");
}

function getVersionScore(model: LlmCatalogModel): number {
  const text = `${model.name} ${model.id}`.toLowerCase();
  const numbers = [...text.matchAll(/\b(\d+)(?:[.-](\d+))?\b/g)].map(
    ([, major, minor]) => Number(major) * 100 + Number(minor ?? 0),
  );
  return numbers.length ? Math.max(...numbers) : 0;
}

function getPowerScore(model: LlmCatalogModel): number {
  const text = `${model.name} ${model.id}`.toLowerCase();
  const keywordScore = Object.entries(POWER_KEYWORDS).reduce(
    (score, [keyword, value]) =>
      text.includes(keyword) ? score + value : score,
    0,
  );
  const contextScore = Math.log10((model.contextWindow ?? 1) + 1) * 4;
  const outputScore = Math.log10((model.maxTokens ?? 1) + 1) * 3;
  const capabilityScore =
    (model.tags.includes("reasoning") ? 12 : 0) +
    (model.tags.includes("tool-use") ? 4 : 0) +
    (model.tags.includes("web-search") ? 3 : 0) +
    (model.tags.includes("vision") ? 3 : 0);
  const priceSignal =
    (model.pricing?.input ?? 0) * 1_000_000 +
    (model.pricing?.output ?? 0) * 250_000;

  return (
    keywordScore + contextScore + outputScore + capabilityScore + priceSignal
  );
}

function hasRequiredCapabilities(
  model: LlmCatalogModel,
  requiredCapabilities: string[],
) {
  return requiredCapabilities.every((tag) => model.tags.includes(tag));
}

function sortModelViews(items: ModelView[], mode: SortMode) {
  return [...items].sort((left, right) => {
    if (mode === "cost") {
      return (
        left.price - right.price ||
        right.powerScore - left.powerScore ||
        left.model.name.localeCompare(right.model.name)
      );
    }

    if (mode === "recent") {
      return (
        right.recencyScore - left.recencyScore ||
        right.powerScore - left.powerScore ||
        left.model.name.localeCompare(right.model.name)
      );
    }

    if (mode === "power") {
      return (
        right.powerScore - left.powerScore ||
        right.recencyScore - left.recencyScore ||
        left.model.name.localeCompare(right.model.name)
      );
    }

    return (
      Number(right.compatible) - Number(left.compatible) ||
      right.recencyScore - left.recencyScore ||
      right.powerScore - left.powerScore ||
      left.price - right.price ||
      left.model.name.localeCompare(right.model.name)
    );
  });
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [capabilityFilters, setCapabilityFilters] = useState<Set<string>>(
    () => new Set(requiredCapabilities),
  );
  const [sortMode, setSortMode] = useState<SortMode>("recommended");

  useEffect(() => {
    setCapabilityFilters((current) => {
      const next = new Set(current);
      for (const tag of requiredCapabilities) next.add(tag);
      return next;
    });
  }, [requiredCapabilities]);

  const selected = useMemo(
    () => models?.find((entry) => entry.id === model) ?? null,
    [models, model],
  );

  const requiredSet = useMemo(
    () => new Set(requiredCapabilities),
    [requiredCapabilities],
  );

  const allViews = useMemo<ModelView[]>(
    () =>
      (models ?? []).map((entry) => ({
        model: entry,
        compatible: hasRequiredCapabilities(entry, requiredCapabilities),
        powerScore: getPowerScore(entry),
        recencyScore: getVersionScore(entry),
        price: entry.pricing?.input ?? Number.POSITIVE_INFINITY,
      })),
    [models, requiredCapabilities],
  );

  const creators = useMemo(
    () => [...new Set(allViews.map((entry) => entry.model.creator))].sort(),
    [allViews],
  );

  const capabilityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of allViews) {
      for (const tag of entry.model.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((left, right) => {
      const known =
        Number(Boolean(CAPABILITY_BADGES[right[0]])) -
        Number(Boolean(CAPABILITY_BADGES[left[0]]));
      return known || right[1] - left[1] || left[0].localeCompare(right[0]);
    });
  }, [allViews]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filters = [...capabilityFilters];

    return sortModelViews(
      allViews.filter(({ model: entry }) => {
        if (creatorFilter !== "all" && entry.creator !== creatorFilter) {
          return false;
        }
        if (filters.some((tag) => !entry.tags.includes(tag))) return false;
        if (!normalizedQuery) return true;
        return (
          entry.name.toLowerCase().includes(normalizedQuery) ||
          entry.id.toLowerCase().includes(normalizedQuery) ||
          entry.creator.toLowerCase().includes(normalizedQuery) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
        );
      }),
      sortMode,
    );
  }, [allViews, capabilityFilters, creatorFilter, query, sortMode]);

  const groups = useMemo<CreatorGroup[]>(() => {
    const byCreator = new Map<string, ModelView[]>();
    for (const entry of filtered) {
      const bucket = byCreator.get(entry.model.creator);
      if (bucket) bucket.push(entry);
      else byCreator.set(entry.model.creator, [entry]);
    }
    return [...byCreator.entries()].map(([label, items]) => ({ label, items }));
  }, [filtered]);

  const incompatible =
    selected !== null &&
    !hasRequiredCapabilities(selected, requiredCapabilities);
  const statusText = loading
    ? "Loading models…"
    : selected
      ? selected.name
      : model || "Choose model";

  const toggleCapability = (tag: string) => {
    if (requiredSet.has(tag)) return;
    setCapabilityFilters((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  if (error && !models) {
    return (
      <div className={cn("w-full flex flex-col gap-2", className)}>
        <p className="truncate text-xs text-muted-foreground">
          {model ?? "No model selected"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">Couldn't load models</p>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3" /> Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full flex flex-col gap-2", className)}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto w-full justify-between gap-3 px-3 py-2 text-left"
            disabled={loading && !models}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm">{statusText}</span>
              <span className="truncate text-[10px] font-normal text-muted-foreground">
                {selected
                  ? [
                      formatCreator(selected.creator),
                      formatContext(selected.contextWindow),
                      ...selected.tags
                        .filter((tag) => CAPABILITY_BADGES[tag])
                        .slice(0, 3)
                        .map((tag) => CAPABILITY_BADGES[tag]),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Open model catalog"}
              </span>
            </span>
            <SlidersHorizontal className="size-4 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Choose model</DialogTitle>
            <DialogDescription>
              Filter by provider and capabilities, then sort by recommended,
              recency, power, or cost.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search model, provider, capability…"
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">
                  Provider
                </span>
                <FilterButton
                  active={creatorFilter === "all"}
                  onClick={() => setCreatorFilter("all")}
                >
                  All
                </FilterButton>
                {creators.map((creator) => (
                  <FilterButton
                    key={creator}
                    active={creatorFilter === creator}
                    onClick={() => setCreatorFilter(creator)}
                  >
                    {formatCreator(creator)}
                  </FilterButton>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">
                  Capabilities
                </span>
                {capabilityOptions.map(([tag, count]) => (
                  <FilterButton
                    key={tag}
                    active={capabilityFilters.has(tag)}
                    locked={requiredSet.has(tag)}
                    onClick={() => toggleCapability(tag)}
                  >
                    {getCapabilityLabel(tag)}
                    <span className="text-muted-foreground">{count}</span>
                  </FilterButton>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">Sort</span>
                {(
                  [
                    ["recommended", "Recommended"],
                    ["recent", "Recency"],
                    ["power", "Power"],
                    ["cost", "Cost"],
                  ] as const
                ).map(([value, label]) => (
                  <FilterButton
                    key={value}
                    active={sortMode === value}
                    onClick={() => setSortMode(value)}
                  >
                    {label}
                  </FilterButton>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              {groups.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  No matching models.
                </div>
              ) : (
                <div className="divide-y">
                  {groups.map((group) => (
                    <section key={group.label}>
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-2 backdrop-blur">
                        <span className="text-xs font-medium text-muted-foreground">
                          {formatCreator(group.label)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {group.items.length} models
                        </span>
                      </div>
                      <div className="divide-y">
                        {group.items.map((entry) => (
                          <ModelRow
                            key={entry.model.id}
                            item={entry}
                            selected={entry.model.id === model}
                            onSelect={() => {
                              onModelChange(entry.model.id);
                              setOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {incompatible && (
        <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
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

function FilterButton({
  active,
  locked,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        locked && "cursor-default opacity-90",
        className,
      )}
      {...props}
    />
  );
}

function ModelRow({
  item,
  selected,
  onSelect,
}: {
  item: ModelView;
  selected: boolean;
  onSelect: () => void;
}) {
  const { model } = item;
  const meta = [
    model.id,
    formatContext(model.contextWindow),
    formatTokens(model.maxTokens),
    formatPrice(model),
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent",
      )}
    >
      <span
        className={cn(
          "mt-1 size-2 rounded-full border",
          selected ? "border-primary bg-primary" : "border-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{model.name}</span>
          {!item.compatible && (
            <Badge
              variant="outline"
              className="text-[10px] text-amber-600 dark:text-amber-500"
            >
              incompatible
            </Badge>
          )}
        </span>
        <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
          {meta.join(" · ")}
        </span>
        {model.tags.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {model.tags.slice(0, 8).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {getCapabilityLabel(tag)}
              </Badge>
            ))}
          </span>
        )}
      </span>
      <span className="hidden shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground sm:flex">
        <span>power {Math.round(item.powerScore)}</span>
        <span>v{item.recencyScore || "—"}</span>
      </span>
    </button>
  );
}
