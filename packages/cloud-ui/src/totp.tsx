"use client";

import type { CloudAuthClient } from "@repo/cloud-auth-client";
import { Button } from "@repo/ui/button";
import { CopyButton, useCopy } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { type FormEvent, useEffect, useRef, useState } from "react";

// A URI that fails to parse must not throw during render — that would take
// down the page, including the backup codes shown on the next step.
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
  authClient,
  password,
  onVerified,
  onFailed,
}: {
  authClient: CloudAuthClient;
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
        onFailedRef.current(enableError?.message ?? "TOTP enrollment failed");
        return;
      }
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
    })();
    return () => {
      active = false;
    };
  }, [authClient, password]);

  // `qrcode` is ~50 kB that only enrollment ever needs; importing it here keeps
  // it off the first load of every sign-in.
  useEffect(() => {
    if (!totpUri) return;
    let active = true;
    void (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const url = await toDataURL(totpUri, { margin: 1, width: 208 });
        if (active) setQrDataUrl(url);
      } catch {
        if (active) setQrDataUrl(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [totpUri]);

  const secret = totpUri ? secretFromUri(totpUri) : null;

  const submit = async (event: FormEvent) => {
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
    onVerified(backupCodes);
  };

  if (!totpUri) {
    return <p className="text-xs text-muted-foreground">Issuing secret…</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {qrDataUrl && (
        // A data: URI has nothing for next/image to optimise.
        <img
          src={qrDataUrl}
          alt="TOTP enrollment QR code"
          className="size-48 self-start rounded border bg-white p-2"
        />
      )}
      {secret && (
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 break-all rounded bg-muted/60 px-2 py-1 font-mono text-xs">
            {secret}
          </code>
          <CopyButton value={secret} label="Copy TOTP secret" />
        </div>
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

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy || code.length < 6}>
        Verify
      </Button>
    </form>
  );
}

export function BackupCodes({
  codes,
  onContinue,
}: {
  codes: string[];
  onContinue: () => void;
}) {
  const { copied, failed, copy } = useCopy(0);
  const [downloaded, setDownloaded] = useState(false);

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
    setDownloaded(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Backup codes — shown once</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border p-3 font-mono text-xs">
        {codes.map((backupCode) => (
          <span key={backupCode}>{backupCode}</span>
        ))}
      </div>
      {failed && (
        <p className="text-xs text-destructive" role="alert">
          Clipboard unavailable — download or write these down
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void copy(codes.join("\n"))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          {downloaded ? "Downloaded" : "Download"}
        </Button>
        <Button type="button" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
