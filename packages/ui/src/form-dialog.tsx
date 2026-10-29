"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  type DialogSize,
  DialogTitle,
} from "./dialog";
import { Spinner } from "./spinner";
import { cn } from "./utils";

/**
 * The one shape for a create/edit dialog: fixed header, a scrolling body of
 * fields, and a fixed footer with Cancel and the submit action. Wide by
 * default. Submitting with Enter works because the body is a real form.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "default",
  onSubmit,
  submitLabel = "Save",
  submitDisabled = false,
  pending = false,
  destructive = false,
  footerStart,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  onSubmit: () => void | Promise<void>;
  submitLabel?: ReactNode;
  submitDisabled?: boolean;
  pending?: boolean;
  destructive?: boolean;
  /** Left side of the footer — a delete button on an edit dialog, say. */
  footerStart?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent
        size={size}
        className="flex flex-col gap-0 overflow-hidden p-0"
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending || submitDisabled) return;
            void onSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b px-5 pt-4 pb-3 pr-12">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1">
                {description}
              </DialogDescription>
            ) : null}
          </div>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-5",
              bodyClassName,
            )}
          >
            {children}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {footerStart}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending || submitDisabled}
            >
              {pending ? <Spinner className="size-3.5" /> : null}
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A field inside a FormDialog or a settings page: label, control, hint or error. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Lays fields out in two columns from `sm` up; a field spans both with `sm:col-span-2`. */
export function FormGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>
      {children}
    </div>
  );
}
