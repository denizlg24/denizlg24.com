"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PiCronHistoryEntry } from "@/lib/picron";

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
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b last:border-0 align-top"
                  >
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
                        <span className="text-destructive">{entry.error}</span>
                      ) : (
                        <span className="text-muted-foreground line-clamp-2">
                          {entry.response || "—"}
                        </span>
                      )}
                    </td>
                  </tr>
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
