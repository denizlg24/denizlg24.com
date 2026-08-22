"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface FoodIconMetadata {
  key: string;
  foodGroup: string;
}

interface FoodIconCatalog {
  icons: FoodIconMetadata[];
}

const FOOD_GROUPS = [
  ["baked-goods", "Baked Goods"],
  ["meats", "Meats"],
  ["vegetables", "Vegetables"],
  ["seafood", "Seafood"],
  ["fruit", "Fruit"],
  ["dairy-and-eggs", "Dairy & Eggs"],
  ["drinks", "Drinks"],
  ["sweets", "Sweets"],
  ["nuts-and-seeds", "Nuts & Seeds"],
  ["other", "Other"],
] as const;

type FoodGroup = (typeof FOOD_GROUPS)[number][0];

function getGroupFromIconKey(iconKey: string): FoodGroup {
  const group = FOOD_GROUPS.find(([key]) => iconKey.startsWith(`${key}-`));
  return group?.[0] ?? "other";
}

function isFoodIconCatalog(value: unknown): value is FoodIconCatalog {
  if (typeof value !== "object" || value === null || !("icons" in value)) {
    return false;
  }

  const icons = value.icons;
  return (
    Array.isArray(icons) &&
    icons.every(
      (icon) =>
        typeof icon === "object" &&
        icon !== null &&
        "key" in icon &&
        typeof icon.key === "string" &&
        "foodGroup" in icon &&
        typeof icon.foodGroup === "string",
    )
  );
}

export function FoodIconPicker({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (iconKey: string) => void;
}) {
  const [activeGroup, setActiveGroup] = useState<FoodGroup>(() =>
    getGroupFromIconKey(value),
  );
  const [icons, setIcons] = useState<FoodIconMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch("/food-icons/catalog.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Icon catalog failed with ${response.status}`);
        }
        const body: unknown = await response.json();
        if (!isFoodIconCatalog(body)) {
          throw new Error("Icon catalog has an invalid format");
        }
        setIcons(body.icons);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setError(
          caught instanceof Error ? caught.message : "Could not load icons",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [requestVersion]);

  const visibleIcons = useMemo(
    () => icons.filter((icon) => icon.foodGroup === activeGroup),
    [activeGroup, icons],
  );

  const retry = useCallback(() => {
    setRequestVersion((current) => current + 1);
  }, []);

  return (
    <div className="-mx-4 flex min-h-full flex-col">
      <div
        role="tablist"
        aria-label="Food icon categories"
        className="scrollbar-none flex flex-none snap-x overflow-x-auto border-b border-border px-2"
      >
        {FOOD_GROUPS.map(([group, label]) => (
          <button
            key={group}
            type="button"
            role="tab"
            aria-selected={activeGroup === group}
            onClick={() => setActiveGroup(group)}
            className={cn(
              "relative h-12 shrink-0 snap-start px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors",
              activeGroup === group && "font-medium text-foreground",
            )}
          >
            {label}
            {activeGroup === group ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" />
            ) : null}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-20 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          <span className="ml-2 text-sm">Loading icons</span>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
          <p className="text-sm font-medium">Could not load the icon catalog</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            className="mt-4 rounded-full"
          >
            <RotateCcw className="size-4" />
            Try again
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-x-2 gap-y-4 px-4 py-6">
          {visibleIcons.map((icon) => {
            const selected = icon.key === value;
            const assetKey = icon.key === "other-001" ? "other-006" : icon.key;
            return (
              <button
                key={icon.key}
                type="button"
                aria-label={`Select ${icon.key}`}
                aria-pressed={selected}
                onClick={() => onValueChange(icon.key)}
                className={cn(
                  "flex aspect-square min-h-11 items-center justify-center rounded-2xl border border-transparent p-1.5 transition-colors active:scale-95",
                  selected &&
                    "border-foreground bg-muted ring-2 ring-foreground/15",
                )}
              >
                <img
                  src={`/food-icons/${assetKey}.png`}
                  alt=""
                  aria-hidden="true"
                  width={128}
                  height={128}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-contain"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
