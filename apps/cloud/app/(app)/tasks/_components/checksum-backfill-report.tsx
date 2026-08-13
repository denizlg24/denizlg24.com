"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import type { ChecksumBackfillReport } from "@repo/schemas/cloud";

export function ChecksumBackfillReportView({
  report,
}: {
  report: ChecksumBackfillReport;
}) {
  const done = report.pending - report.remaining;
  return (
    <div className="flex flex-col gap-3">
      {report.blockedBy && (
        <span className="font-mono text-xs text-amber-600 dark:text-amber-500">
          blocked · {report.blockedBy}
        </span>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{report.dryRun ? "dry run" : "applied"}</span>
        <span>
          {report.hashed} hashed · {formatBytes(report.bytesHashed)}
        </span>
        {report.pending > 0 && (
          <span>
            {done} of {report.pending} verified
          </span>
        )}
        {report.remaining > 0 && (
          // What tiering is still waiting on: it cannot move a file it has no
          // checksum to verify the copy against.
          <span className="text-amber-600 dark:text-amber-500">
            {report.remaining} left
          </span>
        )}
        {report.exhausted && <span>stopped on {report.exhausted}</span>}
        {report.skipped.length > 0 && (
          <span>{report.skipped.length} skipped</span>
        )}
        {report.failures.length > 0 && (
          <span className="text-destructive">
            {report.failures.length} failed
          </span>
        )}
      </div>
      {report.skipped.length > 0 && (
        <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
          {report.skipped.map((entry) => (
            <span
              key={entry.relativePath}
              className="font-mono text-[11px] text-muted-foreground"
            >
              {entry.relativePath}: {entry.reason}
            </span>
          ))}
        </div>
      )}
      {report.failures.length > 0 && (
        <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
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
