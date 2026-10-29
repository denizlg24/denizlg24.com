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
    <div className="flex items-center gap-1">
      <span className="px-1 text-xs tabular-nums text-muted-foreground">
        {start}–{end} of {totalRows}
      </span>
      {pageCount > 1 ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={disabled || pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={disabled || pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </>
      ) : null}
    </div>
  );
}
