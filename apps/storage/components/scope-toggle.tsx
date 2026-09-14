"use client";

import { cn } from "@repo/ui/utils";

export type SearchScope = "user" | "shared" | "all";

const OPTIONS: { value: SearchScope; label: string }[] = [
  { label: "My files", value: "user" },
  { label: "Family", value: "shared" },
  { label: "Everything", value: "all" },
];

export function scopeLabel(scope: SearchScope): string {
  return scope === "user"
    ? "your files"
    : scope === "shared"
      ? "the family drive"
      : "everything";
}

export function parseScope(value: string | null): SearchScope {
  return value === "shared" || value === "all" ? value : "user";
}

/** Shared by the palette and the results page so the two cannot drift apart. */
export function ScopeToggle({
  scope,
  onChange,
  className,
}: {
  scope: SearchScope;
  onChange: (scope: SearchScope) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          // Selection is otherwise conveyed by styling alone.
          aria-pressed={scope === option.value}
          className={cn(
            "rounded-full px-3 py-1 text-sm transition-colors",
            scope === option.value
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
