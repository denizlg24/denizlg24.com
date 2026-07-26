"use client";

import { formatDateTime } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api, errorMessage } from "@/lib/api";
import { API_BASE_URL } from "@/lib/env";

// Two mounts rather than one. The root at /dav does hold both as folders, but
// its top level is synthetic: nothing can be created directly in it, so a
// single drive letter shows a writable-looking root that rejects every write.
const HOME_URL = `${API_BASE_URL}/dav/home`;
const SHARED_URL = `${API_BASE_URL}/dav/shared`;

function Command({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-sm bg-muted/50 px-2 py-1.5 font-mono text-xs">
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

function DriveGroup({
  drive,
  children,
}: {
  drive: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-l pl-3">
      <span className="text-xs font-medium">{drive}</span>
      {children}
    </div>
  );
}

function MountGuide({ username }: { username: string }) {
  return (
    <Tabs defaultValue="macos">
      <TabsList variant="line">
        <TabsTrigger value="macos">macOS</TabsTrigger>
        <TabsTrigger value="windows">Windows</TabsTrigger>
        <TabsTrigger value="linux">Linux</TabsTrigger>
      </TabsList>

      <TabsContent value="macos" className="flex flex-col gap-4 pt-3">
        <DriveGroup drive="Home">
          <Command label="Finder ⌘K" value={HOME_URL} />
        </DriveGroup>
        <DriveGroup drive="Shared">
          <Command label="Finder ⌘K" value={SHARED_URL} />
        </DriveGroup>
        <Command
          label="Stop Finder writing .DS_Store to the mounts"
          value="defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true"
        />
      </TabsContent>

      <TabsContent value="windows" className="flex flex-col gap-4 pt-3">
        <Command
          label="Raise the 50 MB download cap — admin shell, once per machine, before mounting"
          value={
            'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters" ' +
            "/v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f && " +
            "net stop webclient && net start webclient"
          }
        />
        <DriveGroup drive="Home → P:">
          <Command
            label="Prompts for the credential"
            value={`net use P: ${HOME_URL} /user:${username} * /persistent:yes`}
          />
        </DriveGroup>
        <DriveGroup drive="Shared → S:">
          <Command
            label="Reuses the cached credential"
            value={`net use S: ${SHARED_URL} /user:${username} * /persistent:yes`}
          />
        </DriveGroup>
      </TabsContent>

      <TabsContent value="linux" className="flex flex-col gap-4 pt-3">
        <DriveGroup drive="Home">
          <Command
            label="davfs2"
            value={`sudo mount -t davfs ${HOME_URL} /mnt/home`}
          />
        </DriveGroup>
        <DriveGroup drive="Shared">
          <Command
            label="davfs2"
            value={`sudo mount -t davfs ${SHARED_URL} /mnt/shared`}
          />
        </DriveGroup>
        <Command
          label="rclone — chunked transfer and a local cache, no size caps"
          value="rclone mount cloud: /mnt/cloud --vfs-cache-mode writes"
        />
      </TabsContent>
    </Tabs>
  );
}

export function NetworkDriveSection() {
  const { user } = useSession();
  const { data: credentials, reload } = usePoll(api.davCredentials.list, null);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<{ name: string; secret: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    try {
      const credential = await api.davCredentials.issue(name.trim());
      setIssued({ name: credential.name, secret: credential.secret });
      setName("");
      await reload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.davCredentials.revoke(id);
      await reload();
      toast.success("Credential revoked");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[7rem_1fr] items-center gap-y-2 text-sm">
        <dt className="text-muted-foreground">Home</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs">{HOME_URL}</span>
          <CopyButton value={HOME_URL} label="Copy home drive URL" />
        </dd>
        <dt className="text-muted-foreground">Shared</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs">{SHARED_URL}</span>
          <CopyButton value={SHARED_URL} label="Copy shared drive URL" />
        </dd>
        <dt className="text-muted-foreground">Username</dt>
        <dd className="truncate">{user.username}</dd>
        <dt className="text-muted-foreground">Password</dt>
        <dd className="text-muted-foreground">
          one credential per device, issued below — used for both drives
        </dd>
      </dl>

      <MountGuide username={user.username} />

      <div className="flex flex-col gap-3">
        <div className="flex max-w-sm items-end gap-2">
          <Input
            aria-label="Credential name"
            placeholder="MacBook Finder"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            disabled={busy || name.trim().length === 0}
            onClick={() => void issue()}
          >
            Issue
          </Button>
        </div>

        {issued && (
          <div className="flex flex-col gap-1 border-l-2 border-status-good pl-3">
            <span className="text-xs text-muted-foreground">
              {issued.name} — shown once
            </span>
            <div className="flex items-center gap-1">
              <code className="font-mono text-sm tracking-wide">
                {issued.secret}
              </code>
              <CopyButton value={issued.secret} label="Copy credential" />
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
              <span className="min-w-0 flex-1 truncate">{credential.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {credential.secretPrefix}…
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {credential.lastUsedAt
                  ? formatDateTime(credential.lastUsedAt)
                  : "never used"}
              </span>
              <ConfirmButton
                trigger={
                  <Button variant="ghost" size="sm">
                    Revoke
                  </Button>
                }
                title={`Revoke ${credential.name}?`}
                description="Any device mounted with it loses access immediately."
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
