"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { type ReactNode, useId, useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionOutcome } from "@/lib/action-result";

export const REASON_MAX = 500;

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  withReason = false,
  successMessage,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  withReason?: boolean;
  successMessage: string;
  onConfirm: (reason: string | undefined) => Promise<ActionOutcome>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const reasonId = useId();

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm(reason.trim() || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setOpen(false);
      setReason("");
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base text-accent-strong">
            {title}
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-1">{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {withReason ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId} className="text-xs text-muted-foreground">
              Reason
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-20 resize-none"
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={confirm}
          >
            {pending ? <Spinner className="size-3.5" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
