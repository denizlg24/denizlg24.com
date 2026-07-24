"use client";

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { type ReactNode, useState } from "react";

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
          <code className="w-fit rounded bg-muted px-2 py-0.5 font-mono text-xs">
            {keyword}
          </code>
          <Input
            autoFocus
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
