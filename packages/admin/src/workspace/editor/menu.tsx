"use client";

import { cn } from "@repo/ui/utils";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/*
 * The one floating list the editor shows: the "/" menu, "@" mentions and
 * ⌘/ turn-into all push their items here and the editor renders it once.
 * Keys reach it through `handleMenuKey`, which the suggestion plugins and the
 * ⌘/ shortcut call before ProseMirror sees them.
 */

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  group?: string;
}

interface MenuState {
  items: MenuItem[];
  index: number;
  rect: { left: number; top: number; bottom: number } | null;
  onPick: ((item: MenuItem) => void) | null;
  open: (
    items: MenuItem[],
    rect: MenuState["rect"],
    onPick: (item: MenuItem) => void,
  ) => void;
  update: (items: MenuItem[], rect: MenuState["rect"]) => void;
  close: () => void;
}

export const useEditorMenu = create<MenuState>((set) => ({
  items: [],
  index: 0,
  rect: null,
  onPick: null,
  open: (items, rect, onPick) => set({ items, rect, onPick, index: 0 }),
  update: (items, rect) =>
    set((s) => ({
      items,
      rect: rect ?? s.rect,
      index: Math.min(s.index, Math.max(0, items.length - 1)),
    })),
  close: () => set({ items: [], rect: null, onPick: null, index: 0 }),
}));

export function menuOpen(): boolean {
  return useEditorMenu.getState().onPick !== null;
}

/** Arrow keys, Enter and Escape while the menu is open; true when it took the key. */
export function handleMenuKey(event: KeyboardEvent): boolean {
  const state = useEditorMenu.getState();
  if (!state.onPick) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const step = event.key === "ArrowDown" ? 1 : -1;
    const count = state.items.length;
    if (count > 0) {
      useEditorMenu.setState({ index: (state.index + step + count) % count });
    }
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    const item = state.items[state.index];
    if (!item) return false;
    const pick = state.onPick;
    state.close();
    pick(item);
    return true;
  }
  if (event.key === "Escape") {
    state.close();
    return true;
  }
  return false;
}

export function EditorMenu() {
  const { items, index, rect, onPick, close } = useEditorMenu();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    if (!onPick) return;
    const away = (event: MouseEvent) => {
      if (
        !(event.target instanceof Node && list.current?.contains(event.target))
      ) {
        close();
      }
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onPick, close]);

  if (!onPick || !rect || typeof document === "undefined") return null;
  const below = rect.bottom + 320 < window.innerHeight;
  let group: string | undefined;

  return createPortal(
    <div
      ref={list}
      role="listbox"
      style={{
        left: Math.min(rect.left, window.innerWidth - 272),
        ...(below
          ? { top: rect.bottom + 6 }
          : { bottom: window.innerHeight - rect.top + 6 }),
      }}
      className="fixed z-50 max-h-80 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">—</div>
      ) : (
        items.map((item, i) => {
          const heading = item.group !== group ? item.group : undefined;
          group = item.group;
          const Icon = item.icon;
          return (
            <div key={item.key}>
              {heading ? (
                <div className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {heading}
                </div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                data-index={i}
                onMouseDown={(event) => {
                  event.preventDefault();
                  close();
                  onPick(item);
                }}
                onMouseEnter={() => useEditorMenu.setState({ index: i })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  i === index && "bg-surface",
                )}
              >
                {Icon ? (
                  <Icon className="size-4 text-muted-foreground" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })
      )}
    </div>,
    document.body,
  );
}
