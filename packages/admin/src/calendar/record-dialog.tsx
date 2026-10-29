"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  type DialogSize,
  DialogTitle,
} from "@repo/ui/dialog";
import type { ReactNode } from "react";

/**
 * A read-only record in a dialog: the same fixed header, scrolling body and
 * fixed footer as FormDialog, without the form. For records that open from a
 * grid (an event, a timetable slot) rather than a page of their own.
 */
export function RecordDialog({
  open,
  onOpenChange,
  title,
  meta,
  size = "default",
  footerStart,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Badges or a short line under the title. */
  meta?: ReactNode;
  size?: DialogSize;
  footerStart?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        className="flex flex-col gap-0 overflow-hidden p-0"
        {...(meta ? {} : { "aria-describedby": undefined })}
      >
        <div className="shrink-0 border-b px-5 pt-4 pb-3 pr-12">
          <DialogTitle className="text-lg leading-tight">{title}</DialogTitle>
          {meta ? (
            <DialogDescription asChild>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {meta}
              </div>
            </DialogDescription>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        {footerStart || footer ? (
          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {footerStart}
            </div>
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
