"use client";

import type { PiCronHistoryEntry } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@repo/ui/dialog";
import { tryFormatJson } from "@repo/utils";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface JobHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  capId: string;
  jobId: string;
  jobName: string;
}

function StatusBadge({ status }: { status: number }) {
  if (status === 0)
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 font-mono">
        ERR
      </Badge>
    );
  if (status >= 200 && status < 300)
    return (
      <Badge className="bg-accent/20 text-accent-strong font-mono">
        {status}
      </Badge>
    );
  if (status >= 400 && status < 500)
    return (
      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 font-mono">
        {status}
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 font-mono">
      {status}
    </Badge>
  );
}

function HistoryRow({ entry }: { entry: PiCronHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const detail = entry.error || entry.response;
  const toggleLabel = expanded ? "Collapse log" : "Show full log";
  return (
    <>
      <tr className="border-b last:border-0 align-top">
        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(entry.started_at), {
            addSuffix: true,
          })}
        </td>
        <td className="py-2 pr-3">
          <StatusBadge status={entry.status} />
        </td>
        <td className="py-2 pr-3 text-xs whitespace-nowrap">
          {entry.duration_ms > 0 ? `${entry.duration_ms}ms` : "—"}
        </td>
        <td className="py-2 text-xs font-mono break-all max-w-xs">
          {entry.error ? (
            <span className="text-destructive line-clamp-2">{entry.error}</span>
          ) : (
            <span className="text-muted-foreground line-clamp-2">
              {entry.response || "—"}
            </span>
          )}
        </td>
        <td className="py-2 pl-2 w-8">
          {detail && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </Button>
          )}
        </td>
      </tr>
      {expanded && detail && (
        <tr className="border-b last:border-0">
          <td colSpan={5} className="py-2">
            <pre
              className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[11px] ${
                entry.error ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {tryFormatJson(detail)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function JobHistoryDialog({
  open,
  onOpenChange,
  resourceId,
  capId,
  jobId,
  jobName,
}: JobHistoryDialogProps) {
  const [history, setHistory] = useState<PiCronHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/admin/resources/${resourceId}/capabilities/${capId}/picron/jobs/${jobId}/history`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error ?? "Failed to load history");
        }
        return res.json() as Promise<PiCronHistoryEntry[]>;
      })
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, resourceId, capId, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogTitle>Execution History</DialogTitle>
        <DialogDescription>
          {jobName} — last 50 runs, newest first.
        </DialogDescription>

        <div className="flex-1 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive text-center py-8">{error}</p>
          )}

          {!loading && !error && history.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No executions recorded yet.
            </p>
          )}

          {!loading && !error && history.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Started</th>
                  <th className="text-left py-2 pr-3 font-medium">Status</th>
                  <th className="text-left py-2 pr-3 font-medium">Duration</th>
                  <th className="text-left py-2 font-medium">
                    Response / Error
                  </th>
                  <th className="py-2 pl-2 w-8">
                    <span className="sr-only">Toggle full log</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
