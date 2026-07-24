"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Check, Copy } from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri.replace("otpauth://", "https://")).searchParams.get(
      "secret",
    );
  } catch {
    return null;
  }
}

/**
 * Arms TOTP for the signed-in account and hands back the one-time backup
 * codes. `twoFactor.enable` re-checks the password, which is why the caller
 * has to supply it rather than relying on the session alone.
 */
export function TotpEnrollment({
  password,
  onVerified,
  onFailed,
}: {
  password: string;
  onVerified: (backupCodes: string[]) => void;
  onFailed: (message: string) => void;
}) {
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  // Callers pass inline arrows, so depending on the callback identity would
  // re-run enrollment on every parent render — issuing a fresh secret and new
  // backup codes while the user is mid-scan. The effect keys on the password
  // alone and reaches the latest callback through a ref.
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: enableError } = await authClient.twoFactor.enable({
        password,
      });
      if (!active) return;
      if (enableError || !data) {
        onFailedRef.current(
          enableError?.message ?? "Could not start two-factor setup",
        );
        return;
      }
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
    })();
    return () => {
      active = false;
    };
  }, [password]);

  useEffect(() => {
    if (!totpUri) return;
    QRCode.toDataURL(totpUri, { margin: 1, width: 208 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [totpUri]);

  const secret = totpUri ? secretFromUri(totpUri) : null;

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2_000);
    } catch {
      setError("Copy is blocked here — type the key into your app instead");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });
    setBusy(false);
    if (verifyError) {
      setError(
        verifyError.message ??
          "That code did not match. Codes change every 30 seconds — try the current one.",
      );
      return;
    }
    onVerified(backupCodes);
  };

  if (!totpUri) {
    return (
      <p className="text-sm text-muted-foreground">Preparing your setup key…</p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Scan this with an authenticator app such as 1Password, Authy or Google
          Authenticator.
        </p>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="Two-factor setup QR code"
            className="size-52 self-start rounded border bg-white p-2"
          />
        )}
        {secret && (
          <div className="flex items-center gap-2">
            <code className="break-all rounded bg-muted/60 px-2 py-1 font-mono text-xs">
              {secret}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void copySecret()}
              aria-label="Copy setup key"
            >
              {secretCopied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="enroll-code" className="text-xs">
          Enter the 6-digit code to confirm
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy || code.length < 6}>
        Confirm
      </Button>
    </form>
  );
}

export function BackupCodes({
  codes,
  onContinue,
  continueLabel = "Continue",
}: {
  codes: string[];
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // These are shown exactly once, so a clipboard write that rejects has to be
  // visible rather than silently swallowed.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setError(null);
    } catch {
      setError("Copy is blocked here — write these down before continuing");
    }
  };

  const download = () => {
    const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deniz-cloud-recovery-codes.txt";
    anchor.click();
    // Revoking in the same task cancels the download in some browsers, and
    // these codes are shown exactly once — a silent failure is unrecoverable.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setCopied(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Save these recovery codes somewhere safe. Each one signs you in once if
        you lose your phone, and this is the only time they are shown.
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded border p-3 font-mono text-xs">
        {codes.map((backupCode) => (
          <span key={backupCode}>{backupCode}</span>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          Download
        </Button>
        <Button type="button" onClick={onContinue}>
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
