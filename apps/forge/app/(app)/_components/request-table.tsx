"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { formatBytes } from "@repo/cloud-ui/format";
import type { ForgeRequestLogRecord } from "@repo/schemas/cloud";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

function statusTone(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-amber-600 dark:text-amber-500";
  if (status >= 300) return "text-muted-foreground";
  return "text-emerald-600 dark:text-emerald-500";
}

/**
 * The requests a deployment recently served.
 *
 * Polled rather than streamed: the access log is a file Caddy appends to, and
 * tailing it as a stream would mean holding a descriptor open per viewer for a
 * list nobody watches line by line. Ten seconds is well inside how long anyone
 * looks at it.
 */
export function RequestTable({ deploymentId }: { deploymentId: string }) {
  const [records, setRecords] = useState<ForgeRequestLogRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecords(await api.forge.requests(deploymentId, 200));
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, [deploymentId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!records) {
    return <p className="text-xs text-muted-foreground">loading…</p>;
  }
  if (records.length === 0) {
    return <p className="text-xs text-muted-foreground">—</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b text-muted-foreground">
            <th className="py-1 pr-2 font-normal">time</th>
            <th className="py-1 pr-2 font-normal">status</th>
            <th className="py-1 pr-2 font-normal">method</th>
            <th className="py-1 pr-2 font-normal">path</th>
            <th className="py-1 pr-2 text-right font-normal">ms</th>
            <th className="py-1 pr-2 text-right font-normal">size</th>
            <th className="py-1 font-normal">client</th>
          </tr>
        </thead>
        <tbody>
          {[...records].reverse().map((record, index) => (
            <tr
              key={`${record.ts}-${index}`}
              className="border-b last:border-b-0"
            >
              <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                {new Date(record.ts).toLocaleTimeString()}
              </td>
              <td
                className={`py-1 pr-2 font-mono tabular-nums ${statusTone(record.status)}`}
              >
                {record.status}
              </td>
              <td className="py-1 pr-2 font-mono">{record.method}</td>
              <td className="max-w-72 truncate py-1 pr-2 font-mono">
                {record.uri}
              </td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">
                {record.durationMs.toFixed(0)}
              </td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums">
                {formatBytes(record.bytesOut)}
              </td>
              <td className="max-w-56 truncate py-1 text-muted-foreground">
                {record.clientIp}
                {record.userAgent ? ` · ${record.userAgent}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
