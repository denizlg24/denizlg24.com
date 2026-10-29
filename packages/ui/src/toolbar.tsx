"use client";

import { MoreHorizontal, SearchIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "./utils";

/** The toolbar's search box: compact, with a clear button once it has text. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
  onKeyDown,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-40 items-center gap-1.5 rounded-md border border-transparent bg-surface/70 px-2 transition-colors focus-within:border-ring/40 focus-within:bg-background dark:bg-surface",
        className,
      )}
    >
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="search"
        value={value}
        // biome-ignore lint/a11y/noAutofocus: opt-in for search-first pages
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
            return;
          }
          onKeyDown?.(event);
        }}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-accent-strong outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="rounded p-0.5 text-muted-foreground hover:text-accent-strong"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export type FilterOption<T extends string> = {
  value: T;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
};

/** Mutually exclusive filters as text pills — the toolbar's tab strip. */
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: FilterOption<T>[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex items-center gap-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40",
              active
                ? "bg-surface font-medium text-accent-strong dark:bg-muted"
                : "text-muted-foreground hover:bg-surface/60 hover:text-accent-strong",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Pushes what follows to the end of a toolbar. */
export function ToolbarSpacer() {
  return <div className="flex-1" />;
}

/** The "…" menu on a row or header. Children are DropdownMenuItems. */
export function RowActions({
  label = "More actions",
  align = "end",
  className,
  children,
}: {
  label?: string;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className={cn("text-muted-foreground", className)}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="min-w-44"
        // The menu is portalled, but React events still bubble to the row
        // that owns the trigger; a menu choice must not also open the row.
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
