"use client";

import { Button } from "@repo/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The hour tracker's one modal surface. Below `md` it is a page sheet that
 * rises from the bottom and stops under the status bar, with its action in
 * the header so the keyboard can never cover it. From `md` up it is the house
 * FormDialog anatomy: title left, scrolling body, Cancel and the action in a
 * fixed footer. Radix rather than vaul: a drag-to-dismiss sheet fights every
 * scroll and wheel picker inside it.
 *
 * `compact` only changes the phone layout: the sheet sizes to its content.
 */
export function HoursSheet({
  open,
  onOpenChange,
  title,
  action,
  compact = false,
  footerStart,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The submit action — the phone header's trailing button, the desktop footer's primary. */
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
  };
  compact?: boolean;
  /** Left of the footer on every size: a delete on an edit sheet. */
  footerStart?: ReactNode;
  /** Replaces the footer: a compact sheet's own confirm button. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const pending = action?.pending ?? false;
  const showFooter = Boolean(footer || footerStart || action);

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Undo the base dialog's centred card below md, keep it from md up.
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
          "max-md:data-[state=open]:slide-in-from-bottom-1/4 max-md:data-[state=closed]:slide-out-to-bottom-1/4 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100",
          compact
            ? "max-md:max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)]"
            : "max-md:h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] max-md:max-h-none md:h-[min(85vh,60rem)]",
        )}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!action || action.disabled || pending) return;
            action.onClick();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid h-13 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-2 md:flex md:h-auto md:px-5 md:pt-4 md:pb-3">
            <div className="flex justify-start md:hidden">
              <Button
                type="button"
                variant="ghost"
                size={action ? "sm" : "icon-sm"}
                onClick={() => onOpenChange(false)}
                aria-label={action ? undefined : "Close"}
                disabled={pending}
                className={cn(action && "text-muted-foreground")}
              >
                {action ? "Cancel" : <X />}
              </Button>
            </div>
            <DialogTitle className="max-w-[55vw] truncate text-center text-sm md:max-w-none md:flex-1 md:text-left md:text-base">
              {title}
            </DialogTitle>
            <div className="flex justify-end md:hidden">
              {action ? (
                <Button
                  type="submit"
                  size="sm"
                  disabled={action.disabled || pending}
                >
                  {pending ? <Spinner className="size-3.5" /> : null}
                  {action.label}
                </Button>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="hidden text-muted-foreground md:inline-flex"
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-5">
            {children}
          </div>
          {showFooter ? (
            <div
              className={cn(
                "shrink-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5 md:pb-3",
                // On a phone the action lives in the header; the footer only
                // carries what sits at its start.
                !footer && !footerStart && "max-md:hidden",
              )}
            >
              {footer ?? (
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {footerStart}
                  </div>
                  {action ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}
                        className="max-md:hidden"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={action.disabled || pending}
                        className="max-md:hidden"
                      >
                        {pending ? <Spinner className="size-3.5" /> : null}
                        {action.label}
                      </Button>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="h-[env(safe-area-inset-bottom)] shrink-0 md:hidden" />
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
