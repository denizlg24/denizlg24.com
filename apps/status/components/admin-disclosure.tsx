"use client";
import { cn } from "@repo/ui/utils";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { optimisticNote } from "@/lib/admin-feedback";
import { useAdminChange } from "./admin-feedback";

export function Disclosure({
  id,
  summary,
  note,
  children,
  className,
}: {
  id?: string;
  summary: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const change = useAdminChange(id);
  const title =
    change?.operation === "config-service"
      ? change.fields.name
      : change?.operation === "maintenance-save"
        ? change.fields.title
        : null;
  return (
    <details className={cn("group border-b", className)} aria-busy={!!change}>
      <summary className="hover:bg-surface/60 flex cursor-pointer list-none items-center gap-2.5 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {title ? (
            <span className="truncate font-medium">{title}</span>
          ) : (
            summary
          )}
        </span>
        {change ? (
          <span
            role="status"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <LoaderCircle
              aria-hidden
              className="size-3 motion-safe:animate-spin"
            />
            {optimisticNote(change)}
          </span>
        ) : null}
        {note ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {note}
          </span>
        ) : null}
      </summary>
      <div className="space-y-4 pb-5 pl-6">{children}</div>
    </details>
  );
}
