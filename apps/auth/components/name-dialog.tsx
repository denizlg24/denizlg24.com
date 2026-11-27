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
import { toast } from "sonner";
import { useAccount, useRefreshAccount } from "@/components/account-gate";
import { enrollmentClient } from "@/lib/auth-client";

const MAX_NAME_LENGTH = 100;

/** The account's display name, which apps receive as the `name` claim. */
export function NameDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useAccount();
  const refreshAccount = useRefreshAccount();
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(account.name);
      setError(null);
    }
  }, [open, account.name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Enter the name you'd like apps to show.");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Use at most ${MAX_NAME_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await enrollmentClient.updateUser({
      name: trimmed,
    });
    setBusy(false);
    if (updateError) {
      setError(updateError.message ?? "Couldn't save your name. Try again.");
      return;
    }
    onOpenChange(false);
    toast.success("Name saved");
    void refreshAccount();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Your name</DialogTitle>
          <DialogDescription>
            Apps you sign in to show this name. Most pick up a change the next
            time you sign in to them.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              autoFocus
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "account-name-error" : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? (
              <p
                id="account-name-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <Spinner aria-hidden="true" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
