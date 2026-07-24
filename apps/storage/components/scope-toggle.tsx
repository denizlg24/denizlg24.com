"use client";

import { cn } from "@repo/ui/utils";

export type SearchScope = "user" | "shared";

const OPTIONS: { value: SearchScope; label: string }[] = [
  { label: "My files", value: "user" },
  { label: "Shared", value: "shared" },
];

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
            "rounded px-2 py-1 text-xs transition-colors",
            scope === option.value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
