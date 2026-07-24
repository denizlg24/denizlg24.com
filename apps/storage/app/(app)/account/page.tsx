"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { BackupCodes, TotpEnrollment } from "@/components/totp-enrollment";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b py-6 first:pt-0 last:border-b-0">
      <h2 className="text-sm font-medium">{title}</h2>
      {description && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-4 max-w-sm">{children}</div>
    </section>
  );
}

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
      toast.error("Couldn't change your password", {
        description: error.message,
      });
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed", {
      description: "You have been signed out everywhere else.",
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
          minLength={8}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <Button
        type="submit"
        className="self-start"
        disabled={busy || current.length === 0 || next.length < 8}
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
    if (intent === "reenroll") {
      setBusy(true);
      // The old secret has to go before a new one can be issued.
      const { error } = await authClient.twoFactor.disable({ password });
      setBusy(false);
      if (error) {
        toast.error("Couldn't start setup", { description: error.message });
        return;
      }
      setMode("enroll");
      return;
    }
    setBusy(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password,
    });
    setBusy(false);
    if (error || !data) {
      toast.error("Couldn't generate new codes", {
        description: error?.message,
      });
      return;
    }
    setCodes(data.backupCodes);
    setMode("codes");
  };

  if (mode === "password") {
    return (
      <form onSubmit={submitPassword} className="flex flex-col gap-4">
        {intent === "reenroll" && (
          // Better Auth cannot hold two secrets at once, so the old one is
          // dropped the moment setup starts. Saying so beats a user walking
          // away half-way and finding their authenticator dead.
          <p className="text-sm text-muted-foreground">
            Your current authenticator stops working as soon as you continue.
            Finish the setup on the next screen, or you will have to start again
            at your next sign-in.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-password" className="text-xs">
            Confirm your password
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
      <TotpEnrollment
        password={password}
        onVerified={(backupCodes) => {
          setCodes(backupCodes);
          setMode("codes");
          void refresh();
        }}
        onFailed={(message) => {
          toast.error("Setup failed", { description: message });
          reset();
        }}
      />
    );
  }

  if (mode === "codes") {
    return (
      <BackupCodes
        codes={codes}
        continueLabel="Done"
        onContinue={() => {
          setCodes([]);
          reset();
        }}
      />
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
        Set up a new device
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setIntent("codes");
          setMode("password");
        }}
      >
        New recovery codes
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
        <div className="mx-auto max-w-2xl">
          <Section title="Signed in as">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="truncate">{user.username}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Member since</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </dl>
          </Section>

          <Section
            title="Password"
            description="Changing your password signs you out on every other device."
          >
            <ChangePassword />
          </Section>

          <Section
            title="Two-factor authentication"
            description="Set up a new device if you changed phones, or replace your recovery codes if you have used or lost them."
          >
            <TwoFactor />
          </Section>
        </div>
      </div>
    </div>
  );
}
