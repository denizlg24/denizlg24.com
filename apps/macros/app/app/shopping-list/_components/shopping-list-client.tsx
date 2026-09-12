"use client";

import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice, useNotice } from "@/components/inline-notice";
import { useFlash } from "@/hooks/use-flash";
import { useHydrated } from "@/hooks/use-hydrated";
import type { FoodSearchItem } from "@/lib/foods/contracts";
import { FoodIcon } from "@/lib/foods/food-icon";
import {
  type ShoppingListItem,
  shoppingListItemResponseSchema,
  shoppingListResponseSchema,
} from "@/lib/shopping-list/contracts";
import { NavTabs } from "../../add/_components/add-food-shared";
import { FoodPickerDrawer } from "./food-picker-drawer";

const SHOPPING_LIST_KEY = ["shopping-list"] as const;

async function readJson(response: Response) {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

async function fetchList(signal?: AbortSignal) {
  const response = await fetch("/api/shopping-list", {
    signal,
    cache: "no-store",
  });
  return shoppingListResponseSchema.parse(await readJson(response)).items;
}

export function ShoppingListClient() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const { flash, flashProps } = useFlash();
  const { notice, showError, clear: clearNotice } = useNotice();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [reordering, setReordering] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: SHOPPING_LIST_KEY,
    queryFn: ({ signal }) => fetchList(signal),
    enabled: hydrated,
    staleTime: 30_000,
  });

  const items = data ?? [];
  const done = items.filter((item) => item.checked).length;

  // Checked lines sink so what is still needed stays at the top of the thumb's
  // reach, while stored order remains what reordering edits.
  const ordered = useMemo(() => {
    const open = items.filter((item) => !item.checked);
    const closed = items.filter((item) => item.checked);
    return [...open, ...closed];
  }, [items]);

  const setItems = useCallback(
    (next: (current: ShoppingListItem[]) => ShoppingListItem[]) => {
      queryClient.setQueryData<ShoppingListItem[]>(
        SHOPPING_LIST_KEY,
        (current) => next(current ?? []),
      );
    },
    [queryClient],
  );

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: SHOPPING_LIST_KEY }),
    [queryClient],
  );

  const addItem = useMutation({
    mutationFn: async (body: {
      label: string;
      note?: string;
      foodId?: string;
      iconKey?: string;
    }) => {
      const response = await fetch("/api/shopping-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return shoppingListItemResponseSchema.parse(await readJson(response))
        .item;
    },
    onSuccess: (item) => {
      setItems((current) => [...current, item]);
      flash(item.id);
    },
    onError: (error) => showError(error, "Could not add item"),
  });

  const patchItem = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const response = await fetch(`/api/shopping-list/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson(response);
    },
    [],
  );

  const toggle = useCallback(
    (item: ShoppingListItem) => {
      const checked = !item.checked;
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, checked } : row)),
      );
      navigator.vibrate?.(12);
      void patchItem(item.id, { checked }).catch((error: unknown) => {
        showError(error, "Could not update item");
        void invalidate();
      });
    },
    [invalidate, patchItem, setItems, showError],
  );

  const commitRename = useCallback(
    (item: ShoppingListItem) => {
      const label = editingDraft.trim();
      setEditingId(null);
      setEditingDraft("");
      if (!label || label === item.label) return;
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, label } : row)),
      );
      flash(item.id);
      void patchItem(item.id, { label }).catch((error: unknown) => {
        showError(error, "Could not rename item");
        void invalidate();
      });
    },
    [editingDraft, flash, invalidate, patchItem, setItems, showError],
  );

  const remove = useCallback(
    (item: ShoppingListItem) => {
      setItems((current) => current.filter((row) => row.id !== item.id));
      void fetch(`/api/shopping-list/${item.id}`, { method: "DELETE" })
        .then(readJson)
        .catch((error: unknown) => {
          showError(error, "Could not remove item");
          void invalidate();
        });
    },
    [invalidate, setItems, showError],
  );

  const clearDone = useCallback(() => {
    setItems((current) => current.filter((row) => !row.checked));
    void fetch("/api/shopping-list", { method: "DELETE" })
      .then(readJson)
      .catch((error: unknown) => {
        showError(error, "Could not clear checked items");
        void invalidate();
      });
  }, [invalidate, setItems, showError]);

  const move = useCallback(
    (item: ShoppingListItem, direction: -1 | 1) => {
      const current = items.slice().sort((a, b) => a.position - b.position);
      const index = current.findIndex((row) => row.id === item.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return;
      const next = current.slice();
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return;
      next[index] = displaced;
      next[target] = moved;
      const repositioned = next.map((row, position) => ({ ...row, position }));
      setItems(() => repositioned);
      flash(item.id);
      navigator.vibrate?.(12);

      void fetch("/api/shopping-list/reorder", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: repositioned.map((row) => row.id) }),
      })
        .then(readJson)
        .catch((error: unknown) => {
          showError(error, "Could not reorder list");
          void invalidate();
        });
    },
    [flash, invalidate, items, setItems, showError],
  );

  function submitDraft() {
    const label = draft.trim();
    if (!label) return;
    setDraft("");
    addItem.mutate({ label });
    composerRef.current?.focus();
  }

  const pickFood = useCallback(
    (item: FoodSearchItem) => {
      addItem.mutate({
        label: item.name,
        ...(item.brand ? { note: item.brand.slice(0, 80) } : {}),
        foodId: item.id,
        iconKey: item.iconKey,
      });
    },
    [addItem],
  );

  useEffect(() => {
    if (reordering) setEditingId(null);
  }, [reordering]);

  return (
    <div className="min-h-dvh pb-32">
      <header className="macros-page-top flex items-end gap-3 px-5 pb-4">
        <h1 className="flex-1 text-3xl font-black tracking-tight">Shopping</h1>
        <span className="pb-1 text-sm tabular-nums text-muted-foreground">
          {done}/{items.length}
        </span>
      </header>

      <NavTabs />

      <InlineNotice notice={notice} onDismiss={clearNotice} />

      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <input
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder="Add item"
          aria-label="Add item"
          enterKeyHint="done"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={submitDraft}
          disabled={!draft.trim()}
          aria-label="Add item"
          className="flex size-8 shrink-0 items-center justify-center border-2 border-dashed border-muted-foreground/60 text-muted-foreground disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        <ActionChip icon={Search} onClick={() => setPickerOpen(true)}>
          From foods
        </ActionChip>
        <ActionChip
          icon={ArrowUpDown}
          active={reordering}
          onClick={() => setReordering((current) => !current)}
        >
          Reorder
        </ActionChip>
        <span className="flex-1" />
        {done > 0 ? (
          <button
            type="button"
            onClick={clearDone}
            className="text-[12px] font-medium text-muted-foreground"
          >
            Clear {done}
          </button>
        ) : null}
      </div>

      {!hydrated || isLoading ? (
        <ListLoading />
      ) : ordered.length === 0 ? (
        <p className="px-5 py-10 text-3xl leading-none font-light text-muted-foreground">
          —
        </p>
      ) : (
        ordered.map((item) => (
          <div
            key={item.id}
            {...flashProps(item.id)}
            className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5"
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={item.checked}
              aria-label={`${item.checked ? "Uncheck" : "Check"} ${item.label}`}
              onClick={() => toggle(item)}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center border-2 transition-colors",
                item.checked
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground text-transparent",
              )}
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                <path
                  d="M4 10.5l4 4 8-9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {item.iconKey || item.foodId ? (
              <FoodIcon
                name={item.label}
                iconKey={item.iconKey}
                className={cn(
                  "size-6 shrink-0 text-muted-foreground",
                  item.checked && "opacity-40",
                )}
              />
            ) : null}

            {editingId === item.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: focus follows the tap that opened the field
                autoFocus
                value={editingDraft}
                onChange={(event) => setEditingDraft(event.target.value)}
                onBlur={() => commitRename(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename(item);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingId(null);
                    setEditingDraft("");
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (reordering) return;
                  setEditingDraft(item.label);
                  setEditingId(item.id);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={cn(
                    "block truncate text-[15px] leading-tight",
                    item.checked && "text-muted-foreground line-through",
                  )}
                >
                  {item.label}
                </span>
                {item.note ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.note}
                  </span>
                ) : null}
              </button>
            )}

            {reordering ? (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Move ${item.label} up`}
                  onClick={() => move(item, -1)}
                  className="flex size-9 items-center justify-center text-muted-foreground"
                >
                  <ChevronUp className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.label} down`}
                  onClick={() => move(item, 1)}
                  className="flex size-9 items-center justify-center text-muted-foreground"
                >
                  <ChevronDown className="size-5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                onClick={() => remove(item)}
                className="flex size-8 shrink-0 items-center justify-center text-muted-foreground active:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))
      )}

      <FoodPickerDrawer
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={pickFood}
        onError={showError}
      />
    </div>
  );
}

function ActionChip({
  icon: Icon,
  children,
  active = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "border border-border/70 active:bg-muted",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function ListLoading() {
  return (
    <div>
      {[1, 2, 3, 4, 5].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-border/40 px-4 py-3"
        >
          <Skeleton className="size-6" />
          <Skeleton className="h-3.5 w-7/12" />
        </div>
      ))}
    </div>
  );
}
