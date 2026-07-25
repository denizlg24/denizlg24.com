"use client";

import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { takeEnrollPassword } from "@/lib/enroll-handoff";

type Step = "password" | "enroll" | "codes";

const TITLES: Record<Step, string> = {
  password: "TOTP enrollment",
  enroll: "TOTP enrollment",
  codes: "Backup codes",
};

export default function SetupMfaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("password");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handoff = takeEnrollPassword();
    if (handoff) {
      setPassword(handoff);
      setStep("enroll");
    }
    setReady(true);
  }, []);

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStep("enroll");
  };

  // Bounces back to the password step so a wrong password or an expired
  // session cannot dead-end on a blank QR panel.
  const onFailed = useCallback((message: string) => {
    setError(message);
    setPassword("");
    setStep("password");
  }, []);

  const onVerified = useCallback((codes: string[]) => {
    setBackupCodes(codes);
    setStep("codes");
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/login");
  };

  if (!ready) return null;

  return (
    <AuthShell title={TITLES[step]} error={error}>
      {step === "password" && (
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password" className="text-xs">
              Password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={password.length === 0}>
            Continue
          </Button>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void signOut()}
          >
            Sign out instead
          </button>
        </form>
      )}

      {step === "enroll" && (
        <TotpEnrollment
          authClient={authClient}
          password={password}
          onVerified={onVerified}
          onFailed={onFailed}
        />
      )}

      {step === "codes" && (
        <BackupCodes
          codes={backupCodes}
          onContinue={() => router.replace("/")}
        />
      )}
    </AuthShell>
  );
}
