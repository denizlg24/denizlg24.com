"use client";

import { formatBytes, formatDateTime } from "@repo/cloud-ui/format";
import { ThemeSelect } from "@repo/cloud-ui/theme";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { MIN_PASSWORD_LENGTH } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { keys } from "@/lib/folder-cache";

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
    toast.success("Password changed", {
      description: "Any other device that was signed in has been signed out.",
    });
  };

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password" className="text-sm">
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
        <Label htmlFor="new-password" className="text-sm">
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
          <p className="text-sm text-status-warning">
            This turns off your current authenticator app immediately. Have your
            phone ready to scan the new code.
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
        Change authenticator app
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setIntent("codes");
          setMode("password");
        }}
      >
        Get new backup codes
      </Button>
    </div>
  );
}

function StorageMeter() {
  const usage = useQuery({
    queryKey: keys.usage,
    queryFn: () => api.usage(),
    staleTime: 60_000,
  });
  const data = usage.data;
  const personalShare =
    data && data.totalBytes > 0
      ? (data.personalBytes / data.totalBytes) * 100
      : 0;
  return (
    <div className="flex max-w-md flex-col gap-3">
      <p className="text-lg font-medium tabular-nums">
        {data ? `You're using ${formatBytes(data.totalBytes)}` : "\u00a0"}
      </p>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          data
            ? `${formatBytes(data.personalBytes)} in My files, ${formatBytes(data.familyBytes)} in Family`
            : "Loading storage use"
        }
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${personalShare}%` }}
        />
        <div
          className="h-full bg-kind-folder transition-[width]"
          style={{
            width: `${data && data.totalBytes > 0 ? 100 - personalShare : 0}%`,
          }}
        />
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" />
          My files
        </dt>
        <dd className="tabular-nums">
          {data ? formatBytes(data.personalBytes) : "—"}
        </dd>
        <dt className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full bg-kind-folder" />
          Family
        </dt>
        <dd className="tabular-nums">
          {data ? formatBytes(data.familyBytes) : "—"}
        </dd>
      </dl>
      <p className="text-sm text-muted-foreground">
        Only files you added count towards this. Family counts what you put in
        the shared drive.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useSession();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 pb-3 pt-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Settings
        </h1>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-10">
          <Section title="Account">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="truncate">{user.username}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Member since</dt>
              <dd className="tabular-nums">{formatDateTime(user.createdAt)}</dd>
            </dl>
          </Section>

          <Section title="Security">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Password</h3>
                <ChangePassword />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Authenticator app</h3>
                <p className="text-sm text-muted-foreground">
                  The six-digit code you type at sign-in comes from an app on
                  your phone. Change the app if you got a new phone, or get
                  fresh backup codes if you have used yours.
                </p>
                <TwoFactor />
              </div>
            </div>
          </Section>

          <Section title="Appearance">
            <ThemeSelect />
          </Section>

          <Section title="Storage">
            <StorageMeter />
          </Section>
        </div>
      </div>
    </div>
  );
}
