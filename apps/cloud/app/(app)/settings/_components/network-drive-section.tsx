"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { formatDateTime } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/env";

const DAV_URL = `${API_BASE_URL}/dav`;

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

function MountGuide() {
  return (
    <Tabs defaultValue="macos">
      <TabsList variant="line">
        <TabsTrigger value="macos">macOS</TabsTrigger>
        <TabsTrigger value="windows">Windows</TabsTrigger>
        <TabsTrigger value="linux">Linux</TabsTrigger>
      </TabsList>

      <TabsContent value="macos" className="flex flex-col gap-3 pt-3">
        <Command label="Finder ⌘K" value={DAV_URL} />
        <Command
          label="mount from a shell"
          value={`mkdir -p /Volumes/cloud && mount_webdav -i ${DAV_URL} /Volumes/cloud`}
        />
        <Command
          label="stop Finder writing .DS_Store to the mount"
          value="defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true"
        />
      </TabsContent>

      <TabsContent value="windows" className="flex flex-col gap-3 pt-3">
        <Command
          label="map the drive"
          value={`net use Z: ${DAV_URL} /persistent:yes`}
        />
        <Command
          label="raise the 50 MB download cap — admin shell, required before any large file works"
          value={
            'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters" ' +
            "/v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f && " +
            "net stop webclient && net start webclient"
          }
        />
      </TabsContent>

      <TabsContent value="linux" className="flex flex-col gap-3 pt-3">
        <Command
          label="davfs2"
          value={`sudo mount -t davfs ${DAV_URL} /mnt/cloud`}
        />
        <Command
          label="rclone — chunked transfer and a local cache, no size caps"
          value={`rclone mount cloud: /mnt/cloud --vfs-cache-mode writes`}
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
    <Section title="network drive" count={credentials?.length}>
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1 text-xs">
          <dt className="text-muted-foreground">url</dt>
          <dd className="flex items-center gap-1 font-mono">
            {DAV_URL}
            <CopyButton value={DAV_URL} label="Copy WebDAV URL" />
          </dd>
          <dt className="text-muted-foreground">username</dt>
          <dd className="font-mono">{user.username}</dd>
          <dt className="text-muted-foreground">password</dt>
          <dd className="font-mono text-muted-foreground">
            a credential issued below — not the account password
          </dd>
        </dl>

        <MountGuide />

        <div className="flex flex-col gap-3">
          <div className="flex max-w-sm items-end gap-2">
            <Input
              aria-label="Credential name"
              placeholder="MacBook Finder"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              size="sm"
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIssued(null)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}

          <ul className="flex flex-col text-xs">
            {credentials?.map((credential) => (
              <li
                key={credential.id}
                className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate">{credential.name}</span>
                <span className="font-mono text-muted-foreground">
                  {credential.secretPrefix}…
                </span>
                <span className="tabular-nums text-muted-foreground">
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
    </Section>
  );
}
