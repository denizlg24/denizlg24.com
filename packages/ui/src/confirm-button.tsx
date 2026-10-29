"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

type ConfirmContentProps = {
  title: string;
  description?: ReactNode;
  /** Extra controls between the description and the actions — a picker the
   *  confirmation depends on, say. Keep it to a single decision. */
  body?: ReactNode;
  actionLabel: string;
  /** Destructive actions (delete, revoke, discard) get the red button. */
  destructive?: boolean;
  /** Disables both buttons while the confirmed action runs. */
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
};

function ConfirmContent({
  title,
  description,
  body,
  actionLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmContentProps) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description !== undefined && (
          <AlertDialogDescription>{description}</AlertDialogDescription>
        )}
      </AlertDialogHeader>
      {body}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant={destructive ? "destructive" : "default"}
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {actionLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/** A trigger that asks before acting. */
export function ConfirmButton({
  trigger,
  ...content
}: ConfirmContentProps & { trigger: ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <ConfirmContent {...content} />
    </AlertDialog>
  );
}

/** The controlled form, for confirmations opened from a menu item. */
export function ConfirmDialog({
  open,
  onOpenChange,
  ...content
}: ConfirmContentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmContent {...content} />
    </AlertDialog>
  );
}
