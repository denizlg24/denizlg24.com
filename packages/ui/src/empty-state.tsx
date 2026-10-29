import type { ReactNode } from "react";
import { cn } from "./utils";

/**
 * What a list shows when it has nothing: a glyph, a terse label ("No notes",
 * "0 results") and optionally the one action that fills it. No instructions.
 */
export function EmptyState({
  icon,
  label,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  action?: ReactNode;
  /** Inline in a section rather than centred in the page. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center text-muted-foreground",
        compact ? "py-6" : "min-h-48 flex-1 py-16",
        className,
      )}
    >
      {icon ? (
        <span className="text-muted-foreground/60 [&_svg:not([class*='size-'])]:size-6">
          {icon}
        </span>
      ) : null}
      <span className="text-sm">{label}</span>
      {action}
    </div>
  );
}
