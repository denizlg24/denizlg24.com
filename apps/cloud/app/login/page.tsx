"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { type FormEvent, Suspense, useEffect, useState } from "react";
import { api, isApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Step = "credentials" | "totp" | "recovery" | "enroll" | "backup-codes";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    if (!totpUri) return;
    QRCode.toDataURL(totpUri, { margin: 1, width: 192 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [totpUri]);

  const finish = async () => {
    try {
      const me = await api.me();
      if (me.role !== "superuser") {
        await authClient.signOut();
        setStep("credentials");
        setError("Superuser required");
        return;
      }
      router.replace("/");
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_ENROLLMENT_REQUIRED") {
        await startEnrollment();
        return;
      }
      setError("Session check failed");
    }
  };

  const startEnrollment = async () => {
    const { data, error: enableError } = await authClient.twoFactor.enable({
      password,
    });
    if (enableError || !data) {
      setError(enableError?.message ?? "TOTP enrollment failed");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setCode("");
    setStep("enroll");
  };

  const submitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: signInError } = await authClient.signIn.username({
      username,
      password,
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message ?? "Sign in failed");
      return;
    }
    if (data && "twoFactorRedirect" in data) {
      setCode("");
      setStep("totp");
      return;
    }
    await finish();
  };

  const submitTotp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "Invalid code");
      return;
    }
    await finish();
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyBackupCode({
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "Invalid recovery code");
      return;
    }
    await finish();
  };

  const submitEnrollVerify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "Invalid code");
      return;
    }
    setStep("backup-codes");
  };

  const secret = totpUri
    ? new URL(totpUri.replace("otpauth://", "https://")).searchParams.get(
        "secret",
      )
    : null;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <div className="mb-8">
          <span className="text-sm font-semibold tracking-tight">
            deniz<span className="text-muted-foreground">cloud</span>
          </span>
        </div>

        {reason === "forbidden" && step === "credentials" && (
          <p className="mb-4 text-xs text-destructive">
            Signed out — superuser required
          </p>
        )}
        {error && <p className="mb-4 text-xs text-destructive">{error}</p>}

        {step === "credentials" && (
          <form onSubmit={submitCredentials} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username" className="text-xs">
                Username
              </Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !username || !password}>
              Sign in
            </Button>
          </form>
        )}

        {step === "totp" && (
          <form onSubmit={submitTotp} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code" className="text-xs">
                TOTP code
              </Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                className="font-mono tracking-widest"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || code.length < 6}>
              Verify
            </Button>
            <button
              type="button"
              className="text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setCode("");
                setError(null);
                setStep("recovery");
              }}
            >
              Use a recovery code
            </button>
          </form>
        )}

        {step === "recovery" && (
          <form onSubmit={submitRecovery} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recovery" className="text-xs">
                Recovery code
              </Label>
              <Input
                id="recovery"
                autoFocus
                className="font-mono"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || code.length === 0}>
              Verify
            </Button>
            <button
              type="button"
              className="text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setCode("");
                setError(null);
                setStep("totp");
              }}
            >
              Back to TOTP
            </button>
          </form>
        )}

        {step === "enroll" && (
          <form onSubmit={submitEnrollVerify} className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">TOTP enrollment</p>
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="TOTP QR"
                className="size-48 rounded border bg-white p-2"
              />
            )}
            {secret && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {secret}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enroll-code" className="text-xs">
                TOTP code
              </Label>
              <Input
                id="enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono tracking-widest"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || code.length < 6}>
              Verify
            </Button>
          </form>
        )}

        {step === "backup-codes" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Backup codes — shown once
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
              {backupCodes.map((backupCode) => (
                <span key={backupCode}>{backupCode}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(backupCodes.join("\n"))
                }
              >
                Copy
              </Button>
              <Button onClick={() => void finish()}>Continue</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
