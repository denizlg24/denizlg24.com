"use client";

import { formatRelative } from "@repo/cloud-ui/format";
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
const SHARED_URL = `smb://${SMB_HOST}/Family`;

function DeviceStatus({
  credential,
}: {
  credential: {
    connected?: boolean;
    lastAuthenticatedAt: string | null;
    lastAuthenticatedFrom: string | null;
  };
}) {
  if (credential.connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-status-good">
        <span className="size-2 rounded-full bg-status-good" />
        Connected now
        {credential.lastAuthenticatedFrom &&
          ` from ${credential.lastAuthenticatedFrom}`}
      </span>
    );
  }
  if (credential.lastAuthenticatedAt) {
    return (
      <span className="text-xs text-muted-foreground">
        Connected {formatRelative(credential.lastAuthenticatedAt)}
        {credential.lastAuthenticatedFrom &&
          ` from ${credential.lastAuthenticatedFrom}`}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Never connected</span>;
}

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
      toast.success("Device removed");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // Only the principal just issued, never one picked out of the list. Each
  // device authenticates as its own, so any other row's principal paired with
  // the secret shown below is a login that cannot work — and the guide sits
  // above the reveal panel, so that is the pairing someone reads. Before an
  // issue, and again after the panel is dismissed, it shows a placeholder;
  // an existing device's username is on its own row in the list.
  const latestPrincipal = issued?.principal ?? null;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Your devices</h2>
        {credentials && credentials.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No computer is connected yet. Add one below and follow the steps.
          </p>
        )}
        <ul className="flex flex-col text-sm">
          {credentials?.map((credential) => (
            <li
              key={credential.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{credential.deviceName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  username{" "}
                  <span className="font-mono">{credential.principal}</span>
                </p>
              </div>
              <DeviceStatus credential={credential} />
              <ConfirmButton
                trigger={
                  <Button variant="ghost" size="sm">
                    Remove
                  </Button>
                }
                title={`Remove ${credential.deviceName}?`}
                description="That computer will be disconnected and its password stops working. You can add it again any time."
                actionLabel="Remove"
                onConfirm={() => revoke(credential.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Add this computer</h2>
        <p className="text-sm text-muted-foreground">
          Give it a name you'll recognise, then follow the steps for your
          system. The password is shown once — keep the page open until the
          drive is connected.
        </p>
        <div className="flex max-w-sm items-end gap-2">
          <Input
            aria-label="Device name"
            placeholder="Ana's MacBook"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <Button
            disabled={busy || deviceName.trim().length === 0}
            onClick={() => void issue()}
          >
            Add this computer
          </Button>
        </div>

        {issued && (
          <div className="flex flex-col gap-2 rounded-lg border border-status-good/40 bg-status-good/5 p-3">
            <p className="text-sm font-medium">
              {issued.deviceName} is ready to connect
            </p>
            <p className="text-sm text-muted-foreground">
              Use these when the connect dialog asks. The password is shown only
              now.
            </p>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                Username
              </span>
              <code className="font-mono text-sm">{issued.principal}</code>
              <CopyButton value={issued.principal} label="Copy username" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                Password
              </span>
              <code className="font-mono text-sm tracking-wide">
                {issued.secret}
              </code>
              <CopyButton value={issued.secret} label="Copy password" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setIssued(null)}
            >
              I've saved these
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Connect the drive</h2>
        <dl className="grid grid-cols-[6rem_1fr] items-center gap-y-2 text-sm">
          <dt className="text-muted-foreground">Your files</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs">{PERSONAL_URL}</span>
            <CopyButton value={PERSONAL_URL} label="Copy personal drive URL" />
          </dd>
          <dt className="text-muted-foreground">Family</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs">{SHARED_URL}</span>
            <CopyButton value={SHARED_URL} label="Copy family drive URL" />
          </dd>
        </dl>
        <MountGuide
          host={SMB_HOST}
          personalUrl={PERSONAL_URL}
          principal={latestPrincipal}
          sharedUrl={SHARED_URL}
        />
      </section>
    </div>
  );
}
