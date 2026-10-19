"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  actionButton,
  FormStatus,
  fieldInput,
  fieldLabel,
  type Status,
  textButton,
} from "./controls";

const MIN_PASSWORD_LENGTH = 8;

export function PasswordForm({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-6">
      <ChangePassword email={email} />
      <ResetByEmail email={email} />
    </div>
  );
}

function ChangePassword({ email }: { email: string }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const hintId = useId();
  const statusId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        tone: "error",
        text: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: signOutOthers,
      });
      if (result.error) {
        setStatus({
          tone: "error",
          text:
            result.error.code === "INVALID_PASSWORD"
              ? "That isn’t your current password."
              : (result.error.message ?? "Couldn’t change your password."),
        });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setStatus({
        tone: "success",
        text: signOutOthers
          ? "Password changed. Your other devices are signed out."
          : "Password changed.",
      });
      if (signOutOthers) router.refresh();
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      {/* Lets password managers file the new password under this account. */}
      <input
        type="email"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />
      <label className={fieldLabel}>
        Current password
        <input
          className={fieldInput}
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          disabled={busy}
          aria-describedby={statusId}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label className={fieldLabel}>
        New password
        <input
          className={fieldInput}
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={newPassword}
          disabled={busy}
          aria-describedby={`${hintId} ${statusId}`}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <span id={hintId}>At least {MIN_PASSWORD_LENGTH} characters.</span>
      </label>
      <label className="flex items-center gap-3 text-[15px]">
        <input
          type="checkbox"
          className="size-4 flex-none accent-foreground"
          checked={signOutOthers}
          disabled={busy}
          onChange={(event) => setSignOutOthers(event.target.checked)}
        />
        Sign out of other devices
      </label>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="submit" className={actionButton} disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </button>
        <FormStatus id={statusId} status={status} />
      </div>
    </form>
  );
}

function ResetByEmail({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function send() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/register/reset-password",
      });
      setStatus(
        result.error
          ? {
              tone: "error",
              text: result.error.message ?? "Couldn’t send the reset link.",
            }
          : { tone: "success", text: `Sent a reset link to ${email}.` },
      );
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm text-muted-foreground">
      <p>
        Forgot it?{" "}
        <button
          type="button"
          className={textButton}
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? "Sending…" : "Email me a reset link"}
        </button>
      </p>
      <FormStatus status={status} className="mt-1" />
    </div>
  );
}
