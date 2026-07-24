"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Section } from "@/components/section";
import { useSession } from "@/components/session-provider";
import { healthTone, StatusDot } from "@/components/status-dot";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_BASE_URL, STORAGE_APP_URL } from "@/lib/env";
import { formatBytes, formatDateTime, formatPercent } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async () => {
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
    toast.success("Password changed — other sessions revoked");
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  return (
    <Section title="password">
      <div className="flex max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password" className="text-xs">
            Current
          </Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password" className="text-xs">
              New
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password" className="text-xs">
              Repeat
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
        </div>
        <Button
          className="w-fit"
          size="sm"
          disabled={
            busy || current.length === 0 || next.length < 8 || next !== confirm
          }
          onClick={() => void change()}
        >
          Change password
        </Button>
      </div>
    </Section>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          backup codes — shown once
        </span>
        <CopyButton value={codes.join("\n")} />
      </div>
      <div className="grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
    </div>
  );
}

function TotpSection() {
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!totpUri) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(totpUri, { margin: 1, width: 176 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [totpUri]);

  const begin = async () => {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Re-enroll failed");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setVerified(false);
    setCode("");
  };

  const verify = async () => {
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Invalid code");
      return;
    }
    setVerified(true);
    toast.success("TOTP re-enrolled");
  };

  const regenerateCodes = async () => {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Backup code regeneration failed");
      return;
    }
    setTotpUri(null);
    setBackupCodes(data.backupCodes);
    setVerified(true);
  };

  const secret = totpUri
    ? new URL(totpUri.replace("otpauth://", "https://")).searchParams.get(
        "secret",
      )
    : null;

  return (
    <Section title="totp">
      <div className="flex max-w-sm flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="totp-password" className="text-xs">
              Password
            </Label>
            <Input
              id="totp-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || password.length === 0}
            onClick={() => void begin()}
          >
            Re-enroll
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || password.length === 0}
            onClick={() => void regenerateCodes()}
          >
            New codes
          </Button>
        </div>
        {totpUri && !verified && (
          <div className="flex flex-col gap-3">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="TOTP QR"
                className="size-44 rounded border bg-white p-2"
              />
            )}
            {secret && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {secret}
              </p>
            )}
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="totp-verify" className="text-xs">
                  Code
                </Label>
                <Input
                  id="totp-verify"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-32 font-mono tracking-widest"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={busy || code.length < 6}
                onClick={() => void verify()}
              >
                Verify
              </Button>
            </div>
          </div>
        )}
        {backupCodes.length > 0 && (verified || totpUri === null) && (
          <BackupCodes codes={backupCodes} />
        )}
      </div>
    </Section>
  );
}

function EnvironmentSection() {
  const { data: healthz } = usePoll(api.healthz, null);
  const { data: health } = usePoll(api.ops.health, 30_000);
  const { data: overview } = usePoll(api.ops.overview, null);

  return (
    <Section title="environment">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
          <dt className="text-muted-foreground">api</dt>
          <dd className="font-mono">
            {API_BASE_URL}
            {healthz && (
              <span className="ml-2 text-muted-foreground">
                v{healthz.version}
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">storage app</dt>
          <dd className="font-mono">{STORAGE_APP_URL}</dd>
          {overview && (
            <>
              <dt className="text-muted-foreground">host</dt>
              <dd className="font-mono">
                {overview.cpu.cores} cores ·{" "}
                {formatBytes(overview.memory.totalBytes)} ram ·{" "}
                {overview.containers.length} containers
              </dd>
              <dt className="text-muted-foreground">disks</dt>
              <dd className="font-mono">
                {overview.disks
                  .map(
                    (disk) =>
                      `${disk.device} ${formatBytes(disk.totalBytes)} (${formatPercent(disk.usagePercent)})`,
                  )
                  .join(" · ") || "—"}
              </dd>
              <dt className="text-muted-foreground">network</dt>
              <dd className="font-mono">
                {overview.network
                  .map((network) => network.interface)
                  .join(" · ") || "—"}
              </dd>
            </>
          )}
        </dl>
        {health && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {Object.entries(health.checks).map(([name, check]) => (
              <span
                key={name}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                title={check.message ?? undefined}
              >
                <StatusDot tone={healthTone(check.status)} />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const { user } = useSession();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-base font-semibold leading-tight">
          {user.username}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          {user.role} · {user.email ?? "no email"} · since{" "}
          {formatDateTime(user.createdAt)}
        </p>
      </div>
      <PasswordSection />
      <TotpSection />
      <EnvironmentSection />
    </div>
  );
}
