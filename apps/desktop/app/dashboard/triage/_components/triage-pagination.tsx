"use client";

import { Button } from "@repo/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function TriagePagination({
  pageIndex,
  pageSize,
  totalRows,
  disabled,
  onPageChange,
}: {
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  disabled?: boolean;
  onPageChange: (pageIndex: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b pb-2">
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {start}–{end} of {totalRows}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous page"
            className="size-7"
            disabled={disabled || pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
            {pageIndex + 1} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next page"
            className="size-7"
            disabled={disabled || pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
