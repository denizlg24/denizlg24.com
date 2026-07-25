"use client";

import { formatDateTime } from "@repo/cloud-ui/format";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD_LENGTH = 8;

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Password change failed");
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed — other sessions revoked");
  };

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password" className="text-xs">
          Current password
        </Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password" className="text-xs">
          New password
        </Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        className="self-start"
        disabled={
          busy || current.length === 0 || next.length < MIN_PASSWORD_LENGTH
        }
      >
        Change password
      </Button>
    </form>
  );
}

function TwoFactor() {
  const { refresh } = useSession();
  const [mode, setMode] = useState<"idle" | "password" | "enroll" | "codes">(
    "idle",
  );
  const [intent, setIntent] = useState<"reenroll" | "codes">("reenroll");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPassword("");
    setMode("idle");
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (intent === "reenroll") {
      // The old secret has to go before a new one can be issued.
      const { error } = await authClient.twoFactor.disable({ password });
      setBusy(false);
      if (error) {
        toast.error(error.message ?? "Could not start enrollment");
        return;
      }
      setMode("enroll");
      return;
    }
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not generate codes");
      return;
    }
    setCodes(data.backupCodes);
    setMode("codes");
  };

  if (mode === "password") {
    return (
      <form onSubmit={submitPassword} className="flex max-w-sm flex-col gap-4">
        {intent === "reenroll" && (
          // Better Auth cannot hold two secrets at once, so the old one is
          // dropped the moment setup starts — a half-finished re-enrollment
          // leaves the account with no working authenticator.
          <p className="text-xs text-status-warning">
            Revokes the current authenticator immediately
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-password" className="text-xs">
            Password
          </Label>
          <Input
            id="totp-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || password.length === 0}>
            Continue
          </Button>
          <Button type="button" variant="ghost" onClick={reset}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (mode === "enroll") {
    return (
      <div className="max-w-sm">
        <TotpEnrollment
          authClient={authClient}
          password={password}
          onVerified={(backupCodes) => {
            setCodes(backupCodes);
            setMode("codes");
            void refresh();
          }}
          onFailed={(message) => {
            toast.error(message);
            reset();
          }}
        />
      </div>
    );
  }

  if (mode === "codes") {
    return (
      <div className="max-w-sm">
        <BackupCodes
          codes={codes}
          onContinue={() => {
            setCodes([]);
            reset();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => {
          setIntent("reenroll");
          setMode("password");
        }}
      >
        Re-enroll TOTP
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setIntent("codes");
          setMode("password");
        }}
      >
        New backup codes
      </Button>
    </div>
  );
}

export default function AccountPage() {
  const { user } = useSession();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-12 z-20 flex h-12 shrink-0 items-center border-b bg-background px-3">
        <h1 className="text-sm font-medium">Account</h1>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          <Section title="Session">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="truncate">{user.username}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="tabular-nums">{formatDateTime(user.createdAt)}</dd>
            </dl>
          </Section>

          <Section title="Password">
            <ChangePassword />
          </Section>

          <Section title="Two-factor">
            <TwoFactor />
          </Section>
        </div>
      </div>
    </div>
  );
}
