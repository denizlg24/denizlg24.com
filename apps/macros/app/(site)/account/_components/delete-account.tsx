"use client";

import { cn } from "@repo/ui/utils";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useMarkAccountDeleted } from "./account-shell";
import {
  dangerButton,
  FormStatus,
  fieldInput,
  fieldLabel,
  type Status,
  textButton,
} from "./controls";

export function DeleteAccount() {
  const markDeleted = useMarkAccountDeleted();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const statusId = useId();
  const input = useRef<HTMLInputElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) input.current?.focus();
    else if (returnFocus.current) startButton.current?.focus();
    returnFocus.current = false;
  }, [confirming]);

  function cancel() {
    returnFocus.current = true;
    setConfirming(false);
    setPassword("");
    setStatus(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        setStatus({
          tone: "error",
          text:
            result.error.code === "INVALID_PASSWORD"
              ? "That password isn’t right."
              : (result.error.message ?? "Couldn’t delete the account."),
        });
        setBusy(false);
        return;
      }
      // Deleting already cleared this browser's cookie; signing out as well
      // tells any other open tab.
      await authClient.signOut().catch(() => null);
      markDeleted();
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
      setBusy(false);
    }
  }

  return (
    <div className="text-[15px] leading-relaxed text-muted-foreground">
      <p className="text-pretty">
        Deletes your food log, foods, recipes, weigh-ins, progress photos,
        habits and settings, here and in the app. This can’t be undone.
      </p>
      {confirming ? (
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-5 flex flex-col gap-5"
        >
          <p className="text-pretty">
            Want a copy first? Export your statistics in the app under Progress
            › Statistics.
          </p>
          <label className={fieldLabel}>
            Enter your password to confirm
            <input
              ref={input}
              className={fieldInput}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={busy}
              aria-describedby={statusId}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="submit"
              className={dangerButton}
              disabled={busy || !password}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              className={textButton}
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={startButton}
          type="button"
          className={cn(
            textButton,
            "mt-4 text-destructive decoration-destructive/40 hover:text-destructive hover:decoration-destructive",
          )}
          onClick={() => setConfirming(true)}
        >
          Delete account
        </button>
      )}
      <FormStatus id={statusId} status={status} className="mt-2" />
    </div>
  );
}
