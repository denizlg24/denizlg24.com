"use client";

import { cn } from "@repo/ui/utils";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  actionButton,
  FormStatus,
  fieldInput,
  fieldLabel,
  type Status,
  textButton,
} from "./controls";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex flex-col gap-8">
      <NameField saved={name} />
      <EmailField email={email} />
    </div>
  );
}

function NameField({ saved }: { saved: string }) {
  const router = useRouter();
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const statusId = useId();
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== saved;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) {
        setStatus({
          tone: "error",
          text: result.error.message ?? "Couldn’t save your name.",
        });
        return;
      }
      setName(trimmed);
      setStatus({ tone: "success", text: "Saved." });
      router.refresh();
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="flex items-end gap-4">
        <label className={cn(fieldLabel, "flex-1")}>
          Name
          <input
            className={fieldInput}
            autoComplete="name"
            required
            value={name}
            disabled={busy}
            aria-describedby={statusId}
            onChange={(event) => {
              setName(event.target.value);
              setStatus(null);
            }}
          />
        </label>
        <button
          type="submit"
          className={actionButton}
          disabled={busy || !canSave}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <FormStatus id={statusId} status={status} className="mt-2" />
    </form>
  );
}

function EmailField({ email }: { email: string }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const statusId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) input.current?.focus();
    else if (returnFocus.current) changeButton.current?.focus();
    returnFocus.current = false;
  }, [editing]);

  function stopEditing() {
    returnFocus.current = true;
    setEditing(false);
    setNewEmail("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = newEmail.trim();
    if (busy || !target) return;
    if (target.toLowerCase() === email.toLowerCase()) {
      setStatus({ tone: "error", text: "That’s already your email." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await authClient.changeEmail({ newEmail: target });
      if (result.error) {
        setStatus({
          tone: "error",
          text: result.error.message ?? "Couldn’t start the change.",
        });
        return;
      }
      stopEditing();
      setStatus({
        tone: "success",
        text: `Check ${email} for a confirmation link. The change applies once ${target} is verified too. Nothing after a few minutes? That address may already have an account.`,
      });
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {editing ? (
        <form onSubmit={(event) => void submit(event)}>
          <label className={fieldLabel}>
            New email
            <input
              ref={input}
              className={fieldInput}
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              disabled={busy}
              aria-describedby={`${hintId} ${statusId}`}
              onChange={(event) => {
                setNewEmail(event.target.value);
                setStatus(null);
              }}
            />
          </label>
          <p
            id={hintId}
            className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty"
          >
            We’ll ask you to confirm from {email} first, then to verify the new
            address.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="submit"
              className={actionButton}
              disabled={busy || !newEmail.trim()}
            >
              {busy ? "Sending…" : "Send confirmation"}
            </button>
            <button
              type="button"
              className={textButton}
              disabled={busy}
              onClick={stopEditing}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">Email</p>
          <div className="flex min-h-11 items-center justify-between gap-4 border-b">
            <p className="min-w-0 text-base [overflow-wrap:anywhere]">
              {email}
            </p>
            <button
              ref={changeButton}
              type="button"
              className={textButton}
              onClick={() => {
                setStatus(null);
                setEditing(true);
              }}
            >
              Change email
            </button>
          </div>
        </>
      )}
      <FormStatus id={statusId} status={status} className="mt-2" />
    </div>
  );
}
