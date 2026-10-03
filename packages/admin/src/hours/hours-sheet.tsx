"use client";

import { Button } from "@repo/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { cn } from "@repo/ui/utils";
import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The hour tracker's one modal surface. On a phone it is a page sheet that
 * rises from the bottom and stops under the status bar, with its actions in
 * the header so the keyboard can never cover them; from `md` up it is a
 * centred dialog with the same anatomy. Radix rather than vaul: a drag-to-
 * dismiss sheet fights every scroll and wheel picker inside it.
 *
 * `compact` sheets hold one decision and size to their content; their action
 * is a full-width button at the bottom, above the home indicator.
 */
export function HoursSheet({
  open,
  onOpenChange,
  title,
  action,
  compact = false,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The header's trailing action (page sheets) — usually Save. */
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
  };
  compact?: boolean;
  children: ReactNode;
  /** Pinned under the scrolling body: a compact sheet's confirm button. */
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Undo the base dialog's centred card below md, keep it from md up.
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
          "max-md:data-[state=open]:slide-in-from-bottom-1/4 max-md:data-[state=closed]:slide-out-to-bottom-1/4 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100",
          compact
            ? "max-md:max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] md:max-w-sm"
            : "max-md:h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] md:max-h-[85vh] md:max-w-md",
        )}
      >
        <div className="grid h-13 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-2">
          <div className="flex justify-start">
            <Button
              variant="ghost"
              size={action ? "sm" : "icon-sm"}
              onClick={() => onOpenChange(false)}
              aria-label={action ? undefined : "Close"}
              className={cn(action && "text-muted-foreground")}
            >
              {action ? "Cancel" : <X className="size-4" />}
            </Button>
          </div>
          <DialogTitle className="max-w-[55vw] truncate text-center text-sm font-semibold md:max-w-60">
            {title}
          </DialogTitle>
          <div className="flex justify-end">
            {action && (
              <Button
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled || action.pending}
              >
                {action.pending && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {action.label}
              </Button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
        {!footer && (
          <div className="h-[env(safe-area-inset-bottom)] shrink-0" />
        )}
      </DialogContent>
    </Dialog>
  );
}
