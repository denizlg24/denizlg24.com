"use client";

import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";

export function TypedConfirmDialog({
  trigger,
  title,
  keyword,
  actionLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  keyword: string;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Label htmlFor={inputId} className="font-normal">
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
              {keyword}
            </code>
          </Label>
          <Input
            id={inputId}
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="font-mono text-sm"
          />
          <Button
            variant="destructive"
            disabled={typed !== keyword || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
                setTyped("");
              } catch (error) {
                // A consumer that doesn't catch would otherwise leave an
                // unhandled rejection and a dialog stuck open with no reason.
                toast.error(
                  error instanceof Error ? error.message : "Request failed",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
