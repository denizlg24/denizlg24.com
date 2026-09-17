"use client";

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { type FormEvent, useEffect, useState } from "react";

/**
 * One name field, used both to label a passkey about to be created and to
 * rename one. `onSubmit` runs the ceremony or the update; the dialog stays
 * open on failure so the message is read next to the field.
 */
export function PasskeyNameDialog({
  open,
  title,
  description,
  actionLabel,
  initialName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  actionLabel: string;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
    }
  }, [open, initialName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await onSubmit(name.trim());
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="passkey-name">Name</Label>
            <Input
              id="passkey-name"
              autoFocus
              autoComplete="off"
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "passkey-name-error" : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? (
              <p
                id="passkey-name-error"
                className="text-xs text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              aria-busy={busy || undefined}
              disabled={busy || name.trim().length === 0}
            >
              {busy ? <Spinner aria-hidden="true" /> : null}
              {actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
