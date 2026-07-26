"use client";

import { formatDurationMs, formatRelative } from "@repo/cloud-ui/format";
import type { SafeActivityEntry } from "@repo/schemas/cloud";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { useState } from "react";
import { severityTone, statusTone } from "./tone";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  );
}

function ExpandedRow({ entry }: { entry: SafeActivityEntry }) {
  const details: { label: string; value: string }[] = [
    { label: "id", value: entry.id },
    { label: "timestamp", value: new Date(entry.ts).toISOString() },
    {
      label: "actor",
      value: `${entry.actorType}${entry.actorId ? ` · ${entry.actorId}` : ""}`,
    },
  ];
  if (entry.ip) details.push({ label: "ip", value: entry.ip });
  if (entry.targetType) {
    details.push({
      label: "target",
      value: `${entry.targetType}${entry.targetId ? ` · ${entry.targetId}` : ""}`,
    });
  }
  if (entry.userAgent) {
    details.push({ label: "user agent", value: entry.userAgent });
  }

  return (
    <div className="flex flex-col gap-3 bg-muted/30 px-2 py-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
        {details.map((detail) => (
          <Detail key={detail.label} {...detail} />
        ))}
      </div>
      {entry.message && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-destructive">
          {entry.message}
        </pre>
      )}
      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
        <pre className="overflow-x-auto font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ActivityTable({ entries }: { entries: SafeActivityEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">—</p>;
  }

  return (
    <div className="flex flex-col divide-y">
      {entries.map((entry) => {
        const open = expanded === entry.id;
        return (
          <div key={entry.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : entry.id)}
              className={cn(
                "flex w-full items-center gap-3 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50",
                open && "bg-muted/50",
              )}
            >
              <StatusDot
                tone={severityTone(entry.severity)}
                label={entry.severity}
              />
              <span className="w-20 shrink-0 truncate text-muted-foreground">
                {entry.category}
              </span>
              <span className="w-12 shrink-0 font-mono text-muted-foreground">
                {entry.method ?? ""}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">
                {entry.path ?? entry.action}
              </span>
              <span className="hidden w-32 shrink-0 truncate text-muted-foreground sm:block">
                {entry.actorLabel ?? entry.actorType}
              </span>
              {entry.statusCode === null ? (
                <span className="w-10 shrink-0 text-right text-muted-foreground">
                  —
                </span>
              ) : (
                <span className="flex w-10 shrink-0 items-center justify-end gap-1 tabular-nums">
                  <StatusDot tone={statusTone(entry.statusCode)} />
                  {entry.statusCode}
                </span>
              )}
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatDurationMs(entry.durationMs)}
              </span>
              <span className="hidden w-24 shrink-0 text-right tabular-nums text-muted-foreground md:block">
                {formatRelative(entry.ts)}
              </span>
            </button>
            {open && <ExpandedRow entry={entry} />}
          </div>
        );
      })}
    </div>
  );
}
