"use client";

import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

const fieldClass =
  "mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground";

export function DeleteAccountForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const signIn = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (signIn.error) {
        setError(
          signIn.error.message ?? "Could not sign in. Check your details.",
        );
        return;
      }
      const session = await authClient.getSession();
      if (
        session.error ||
        session.data?.user.email.toLowerCase() !== email.trim().toLowerCase()
      ) {
        setError("Could not confirm the account. Please try again.");
        return;
      }
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        setError(result.error.message ?? "Could not delete the account.");
        return;
      }
      setPassword("");
      setDeleted(true);
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <p role="status" className="font-medium text-foreground">
        Your account and its data have been deleted.
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      <p>Sign in with the account you want to delete.</p>
      <label className="block font-medium text-foreground">
        Email
        <input
          className={fieldClass}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className="block font-medium text-foreground">
        Password
        <input
          className={fieldClass}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className="flex items-start gap-3 text-foreground">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-foreground"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy}
          required
        />
        I understand this permanently deletes my account and data.
      </label>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="h-11 self-start rounded-xl bg-destructive px-5 font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || !confirmed}
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
