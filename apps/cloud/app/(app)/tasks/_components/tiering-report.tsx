"use client";

import type { TieringReport } from "@repo/schemas/cloud";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { formatBytes } from "@/lib/format";

export function movedBytes(report: TieringReport): number {
  return report.moved.reduce((total, move) => total + move.sizeBytes, 0);
}

export function TieringReportView({ report }: { report: TieringReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{report.dryRun ? "dry run" : "applied"}</span>
        <span>
          ssd {report.initialSsdUsagePercent.toFixed(1)}% →{" "}
          {report.finalSsdUsagePercent.toFixed(1)}%
        </span>
        <span>{report.considered} considered</span>
        <span>
          {report.moved.length} moves · {formatBytes(movedBytes(report))}
        </span>
        <span>{report.reconciledCopies} reconciled</span>
        {report.failures.length > 0 && (
          <span className="text-destructive">
            {report.failures.length} failed
          </span>
        )}
      </div>
      {report.moved.length > 0 && (
        <div className="max-h-80 overflow-auto border-y">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>file</TableHead>
                <TableHead>direction</TableHead>
                <TableHead>reason</TableHead>
                <TableHead className="text-right">size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.moved.map((move) => (
                <TableRow key={move.fileId}>
                  <TableCell className="max-w-72 truncate font-mono text-xs">
                    {move.filename}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {move.from} → {move.to}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {move.reason}
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
      {report.failures.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {report.failures.map((failure) => (
            <span
              key={failure.fileId}
              className="font-mono text-[11px] text-destructive"
            >
              {failure.fileId}: {failure.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
