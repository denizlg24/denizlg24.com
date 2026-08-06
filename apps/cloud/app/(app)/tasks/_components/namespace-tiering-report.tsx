"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import type { NamespaceTieringReport } from "@repo/schemas/cloud";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";

export function relocatedBytes(report: NamespaceTieringReport): number {
  return report.applied
    .filter((move) => move.outcome === "moved")
    .reduce((total, move) => total + move.sizeBytes, 0);
}

export function NamespaceTieringReportView({
  report,
}: {
  report: NamespaceTieringReport;
}) {
  const rows = report.applied.length > 0 ? report.applied : report.planned;
  return (
    <div className="flex flex-col gap-3">
      {report.blockedBy && (
        <span className="font-mono text-xs text-amber-600 dark:text-amber-500">
          blocked · {report.blockedBy}
        </span>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{report.dryRun ? "dry run" : "applied"}</span>
        {report.ssd && (
          <span>
            ssd {report.ssd.usagePercent.toFixed(1)}% ·{" "}
            {formatBytes(report.ssd.freeBytes)} free
          </span>
        )}
        {report.hdd && (
          <span>
            hdd {report.hdd.usagePercent.toFixed(1)}% ·{" "}
            {formatBytes(report.hdd.freeBytes)} free
          </span>
        )}
        <span>{formatBytes(report.bytesToFree)} to free</span>
        <span>
          {report.eligible} eligible · {report.onSsd} on ssd
        </span>
        <span>
          {report.planned.length} planned ·{" "}
          {formatBytes(relocatedBytes(report))} moved
        </span>
        {report.quarantined.length > 0 && (
          <span className="text-amber-600 dark:text-amber-500">
            {report.quarantined.length} quarantined
          </span>
        )}
        {report.failures.length > 0 && (
          <span className="text-destructive">
            {report.failures.length} failed
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="max-h-80 overflow-auto border-y">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>path</TableHead>
                <TableHead>direction</TableHead>
                <TableHead>outcome</TableHead>
                <TableHead className="text-right">size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((move) => (
                <TableRow key={move.fileId}>
                  <TableCell className="max-w-72 truncate font-mono text-xs">
                    {move.relativePath}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {move.from} → {move.to}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {report.applied.length > 0 ? move.outcome : "planned"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatBytes(move.sizeBytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {report.quarantined.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {report.quarantined.map((entry) => (
            <span
              key={entry.relativePath}
              className="font-mono text-[11px] text-amber-600 dark:text-amber-500"
            >
              {entry.relativePath}: {entry.reason}
            </span>
          ))}
        </div>
      )}
      {report.failures.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {report.failures.map((failure) => (
            <span
              key={failure.relativePath}
              className="font-mono text-[11px] text-destructive"
            >
              {failure.relativePath}: {failure.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
