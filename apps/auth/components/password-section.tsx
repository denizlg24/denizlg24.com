"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
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
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "@/components/account-gate";
import { PageSection } from "@/components/shell-frame";
import { enrollmentClient } from "@/lib/auth-client";

const MAX_PASSWORD_LENGTH = 128;

type FieldErrors = Partial<Record<"current" | "next" | "confirm", string>>;

function validate(current: string, next: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  if (current.length === 0) errors.current = "Enter your current password.";
  if (next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (next.length > MAX_PASSWORD_LENGTH) {
    errors.next = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  } else if (next === current) {
    errors.next = "Choose a password you haven't used here.";
  }
  if (confirm !== next) errors.confirm = "The two new passwords don't match.";
  return errors;
}

/** Better Auth answers a wrong current password with this code. */
function changeErrorMessage(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === "INVALID_PASSWORD") {
    return "That isn't your current password.";
  }
  return error.message ?? "Couldn't change the password. Try again.";
}

export function PasswordSection() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setSignOutOthers(true);
    setErrors({});
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate(current, next, confirm);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const { error } = await enrollmentClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: signOutOthers,
    });
    setBusy(false);
    if (error) {
      if (error.code === "INVALID_PASSWORD") {
        setErrors({ current: changeErrorMessage(error) });
      } else {
        setFailure(changeErrorMessage(error));
      }
      return;
    }
    setOpen(false);
    reset();
    toast.success(
      signOutOthers
        ? "Password changed. Your other devices are signed out."
        : "Password changed",
    );
  };

  const field = (
    id: keyof FieldErrors,
    label: string,
    value: string,
    onChange: (value: string) => void,
    autoComplete: string,
    hint?: string,
  ) => {
    const error = errors[id];
    const describedBy = error
      ? `password-${id}-error`
      : hint
        ? `password-${id}-hint`
        : undefined;
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`password-${id}`}>{label}</Label>
        <Input
          id={`password-${id}`}
          type="password"
          autoComplete={autoComplete}
          autoFocus={id === "current"}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {error ? (
          <p
            id={`password-${id}-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        ) : hint ? (
          <p
            id={`password-${id}-hint`}
            className="text-xs text-muted-foreground"
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <PageSection
      id="password"
      title="Password"
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Change password
        </Button>
      }
    >
      <p className="max-w-prose text-sm text-muted-foreground">
        {account.realm === "public"
          ? "You'll need your current password. If you've forgotten it, sign out and choose “Forgot your password?” the next time you sign in to an app."
          : "You'll need your current password."}
      </p>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Change your password
            </DialogTitle>
            <DialogDescription>
              Pick one you don't use anywhere else. A password manager can make
              and remember it for you.
            </DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            {/* Lets password managers file the new password under the right account. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={account.username ?? account.email}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            {field(
              "current",
              "Current password",
              current,
              setCurrent,
              "current-password",
            )}
            {field(
              "next",
              "New password",
              next,
              setNext,
              "new-password",
              `At least ${MIN_PASSWORD_LENGTH} characters.`,
            )}
            {field(
              "confirm",
              "New password again",
              confirm,
              setConfirm,
              "new-password",
            )}
            <div className="flex items-start gap-2">
              <Checkbox
                id="password-sign-out-others"
                checked={signOutOthers}
                onCheckedChange={(value) => setSignOutOthers(value === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="password-sign-out-others"
                className="text-sm leading-snug font-normal"
              >
                Sign out every other device
              </Label>
            </div>
            {failure ? (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={busy}
                aria-busy={busy || undefined}
              >
                {busy ? <Spinner aria-hidden="true" /> : null}
                Change password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
