"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@repo/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@repo/ui/keyboard-sheet";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type FoodSearchItem,
  foodSearchResponseSchema,
} from "@/lib/foods/contracts";
import { FoodIcon } from "@/lib/foods/food-icon";

async function searchFoods(query: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/foods/search?q=${encodeURIComponent(query)}&limit=20`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return foodSearchResponseSchema.parse(await response.json()).items;
}

export function FoodPickerDrawer({
  open,
  onClose,
  onPick,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: FoodSearchItem) => void;
  onError: (error: unknown, fallback: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FoodSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      setPicked(new Set());
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2) {
      setItems([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsSearching(true);
      searchFoods(trimmed, controller.signal)
        .then(setItems)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          onError(error, "Could not search foods");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [onError, open, query]);

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="flex h-[calc(100dvh-5rem)]! max-h-none! flex-col rounded-t-3xl pb-safe-end">
        <VisuallyHidden>
          <DrawerTitle>Pick foods</DrawerTitle>
          <DrawerDescription>
            Search the food catalogue and add items to the shopping list.
          </DrawerDescription>
        </VisuallyHidden>

        <div className="flex flex-none items-center gap-2 px-3 pt-3 pb-3">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search foods"
              className="h-11 rounded-full bg-muted pr-3 pl-9 text-base"
              enterKeyHint="search"
              autoComplete="off"
              inputMode="search"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close food picker"
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isSearching && items.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-10 text-3xl leading-none font-light text-muted-foreground">
              —
            </p>
          ) : (
            items.map((item) => {
              const added = picked.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onPick(item);
                    setPicked((current) => new Set(current).add(item.id));
                  }}
                  className="flex w-full items-center gap-3 border-t border-border/40 px-4 py-3 text-left"
                >
                  <FoodIcon
                    name={item.name}
                    iconKey={item.iconKey}
                    className="size-7 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-tight font-medium">
                      {item.name}
                    </span>
                    {item.brand ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.brand}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={
                      added
                        ? "text-foreground"
                        : "text-2xl leading-none text-muted-foreground"
                    }
                  >
                    {added ? <Check className="size-5" /> : "+"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
