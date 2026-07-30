"use client";

import type { FinanceAccount } from "@repo/schemas";
import { Label } from "@repo/ui/label";
import type { StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict } from "date-fns";
import type { ReactNode } from "react";

export function relative(value?: string) {
  if (!value) return "never";
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export const CONNECTION_TONE: Record<
  FinanceAccount["connection"]["status"],
  StatusTone
> = {
  active: "good",
  pending: "warning",
  reconnect_required: "critical",
  disconnected: "muted",
};

export function SectionHead({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
      {children}
    </div>
  );
}

export function Figure({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta?: ReactNode;
  tone?: "good" | "critical";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 truncate text-[26px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "good" && "text-status-good",
          tone === "critical" && "text-status-critical",
        )}
      >
        {value}
      </div>
      {meta !== undefined && (
        <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
  );
}

export function Empty({
  label,
  compact,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-xs text-muted-foreground",
        compact ? "py-3" : "py-14 text-center",
      )}
    >
      {label}
    </div>
  );
}

export function FieldRow({
  label,
  children,
  htmlFor,
  className,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={htmlFor}
        className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}
