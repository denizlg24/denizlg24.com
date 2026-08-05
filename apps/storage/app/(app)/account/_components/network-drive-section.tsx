"use client";

import { formatDateTime } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { SMB_HOST } from "@/lib/env";
import { MountGuide } from "./mount-guide";

// Two drives rather than one. The namespace root holds both as folders, but its
// top level is synthetic: nothing can be created directly in it, so a single
// mount would show a writable-looking root that rejects every write.
const PERSONAL_URL = `smb://${SMB_HOST}/Personal`;
const SHARED_URL = `smb://${SMB_HOST}/Shared`;

export function NetworkDriveSection() {
  const { data: credentials, reload } = usePoll(api.smbCredentials.list, null);
  const [deviceName, setDeviceName] = useState("");
  const [issued, setIssued] = useState<{
    deviceName: string;
    principal: string;
    secret: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    try {
      const credential = await api.smbCredentials.issue(deviceName.trim());
      setIssued({
        deviceName: credential.deviceName,
        principal: credential.principal,
        secret: credential.secret,
      });
      setDeviceName("");
      await reload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.smbCredentials.revoke(id);
      await reload();
      toast.success("Device revoked");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // Each device authenticates as its own principal, so the mount guide is only
  // exact once one exists. Before that it shows a placeholder rather than a
  // username that would silently fail.
  const latestPrincipal =
    issued?.principal ?? credentials?.[0]?.principal ?? null;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[7rem_1fr] items-center gap-y-2 text-sm">
        <dt className="text-muted-foreground">Personal</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs">{PERSONAL_URL}</span>
          <CopyButton value={PERSONAL_URL} label="Copy personal drive URL" />
        </dd>
        <dt className="text-muted-foreground">Shared</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs">{SHARED_URL}</span>
          <CopyButton value={SHARED_URL} label="Copy shared drive URL" />
        </dd>
        <dt className="text-muted-foreground">Username</dt>
        <dd className="text-muted-foreground">
          one principal per device, issued below
        </dd>
        <dt className="text-muted-foreground">Reachable</dt>
        <dd className="text-muted-foreground">over the tailnet only</dd>
      </dl>

      <MountGuide
        host={SMB_HOST}
        personalUrl={PERSONAL_URL}
        principal={latestPrincipal}
        sharedUrl={SHARED_URL}
      />

      <div className="flex flex-col gap-3">
        <div className="flex max-w-sm items-end gap-2">
          <Input
            aria-label="Device name"
            placeholder="MacBook"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <Button
            disabled={busy || deviceName.trim().length === 0}
            onClick={() => void issue()}
          >
            Issue
          </Button>
        </div>

        {issued && (
          <div className="flex flex-col gap-1 border-l-2 border-status-good pl-3">
            <span className="text-xs text-muted-foreground">
              {issued.deviceName} — shown once
            </span>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">user</span>
              <code className="font-mono text-sm">{issued.principal}</code>
              <CopyButton value={issued.principal} label="Copy username" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">pass</span>
              <code className="font-mono text-sm tracking-wide">
                {issued.secret}
              </code>
              <CopyButton value={issued.secret} label="Copy password" />
              <Button variant="ghost" size="sm" onClick={() => setIssued(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <ul className="flex flex-col text-sm">
          {credentials?.map((credential) => (
            <li
              key={credential.id}
              className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">
                {credential.deviceName}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {credential.principal}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {credential.lastAuthenticatedAt
                  ? formatDateTime(credential.lastAuthenticatedAt)
                  : "never used"}
              </span>
              <ConfirmButton
                trigger={
                  <Button variant="ghost" size="sm">
                    Revoke
                  </Button>
                }
                title={`Revoke ${credential.deviceName}?`}
                description="Its Samba account is disabled and any open session is closed."
                actionLabel="Revoke"
                onConfirm={() => revoke(credential.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
