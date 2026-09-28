"use client";

import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { primaryButton } from "@/app/_landing/site";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    setMessage("");
    const response = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setSubmitting(false);
    if (response.error) {
      setMessage(response.error.message ?? "Could not reset the password.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-6 pt-2">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            Password updated
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Sign in with your new password.
          </p>
        </div>
        <a href="macros://sign-in" className={`${primaryButton} w-full`}>
          Open Macros
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-2">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          Choose a new password
        </h1>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {message ? <p className="text-xs text-destructive">{message}</p> : null}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className={`${primaryButton} w-full disabled:opacity-60`}
      >
        Save password
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
      </button>
    </form>
  );
}
