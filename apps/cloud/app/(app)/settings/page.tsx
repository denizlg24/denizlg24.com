"use client";

import {
  formatBytes,
  formatDateTime,
  formatPercent,
} from "@repo/cloud-ui/format";
import { healthTone } from "@repo/cloud-ui/status-tone";
import { ThemeSelect } from "@repo/cloud-ui/theme";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { StatusDot } from "@repo/ui/status-dot";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { API_BASE_URL, STORAGE_APP_URL } from "@/lib/env";
import { NetworkDriveSection } from "./_components/network-drive-section";

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

type TotpMode = "idle" | "enroll" | "codes";

function TotpSection() {
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<TotpMode>("idle");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const startEnrollment = async () => {
    setBusy(true);
    // The old secret has to go before a new one can be issued; without this a
    // failed enrollment leaves the previous secret live.
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Could not start enrollment");
      return;
    }
    setMode("enroll");
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
    setBackupCodes(data.backupCodes);
    setMode("codes");
  };

  return (
    <Section title="totp">
      <div className="flex max-w-sm flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
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
            onClick={() => void startEnrollment()}
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

        {mode === "enroll" && (
          <TotpEnrollment
            authClient={authClient}
            password={password}
            onVerified={(codes) => {
              setBackupCodes(codes);
              setMode("codes");
              toast.success("TOTP re-enrolled");
            }}
            onFailed={(message) => {
              toast.error(message);
              setMode("idle");
            }}
          />
        )}

        {mode === "codes" && backupCodes.length > 0 && (
          <BackupCodes
            codes={backupCodes}
            onContinue={() => {
              setBackupCodes([]);
              setPassword("");
              setMode("idle");
            }}
          />
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
                <StatusDot
                  tone={healthTone(check.status)}
                  label={check.status}
                />
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
      <Section title="theme">
        <ThemeSelect />
      </Section>
      <PasswordSection />
      <TotpSection />
      <NetworkDriveSection />
      <EnvironmentSection />
    </div>
  );
}
