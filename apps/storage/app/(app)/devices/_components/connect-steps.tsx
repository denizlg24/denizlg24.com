"use client";

import type { SmbPlatform } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { CopyButton } from "@repo/ui/copy-button";
import { cn } from "@repo/ui/utils";
import { ChevronRight, Download, ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { SMB_HOST } from "@/lib/env";
import {
  DRIVES,
  downloadMacShortcut,
  downloadWindowsShortcut,
  smbUrl,
  uncPath,
} from "./platform";

/**
 * The one step that differs per system. Every value a dialog will ask for is
 * on this screen with a copy button, and the primary action opens that
 * dialog with as much filled in as the platform allows — the password is
 * the only thing left to type anywhere.
 */

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <code
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm bg-muted/50 px-2 py-1 text-xs",
          mono ? "font-mono" : "font-sans",
        )}
      >
        {value}
      </code>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm marker:text-muted-foreground">
      {children}
    </ol>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-muted pl-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{title}</span>
      {children}
    </div>
  );
}

function Advanced({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        Advanced
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Credentials({
  principal,
  secret,
}: {
  principal: string;
  secret: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-status-good/40 bg-status-good/5 p-3">
      <p className="text-sm">
        When it asks you to sign in, use these.{" "}
        {secret && (
          <span className="text-muted-foreground">
            The password is shown only now — keep this page open until the drive
            is connected.
          </span>
        )}
      </p>
      <Field label="Username" value={principal} />
      {secret ? (
        <Field label="Password" value={secret} />
      ) : (
        <p className="text-xs text-muted-foreground">
          The password was shown when this device was added. If it is lost, use
          "Show setup again" to get a new one.
        </p>
      )}
    </div>
  );
}

export function ConnectSteps({
  platform,
  principal,
}: {
  platform: SmbPlatform;
  principal: string;
}) {
  const personal = DRIVES[0];
  const family = DRIVES[1];

  if (platform === "mac") {
    return (
      <div className="flex flex-col gap-5">
        <Section title="Open the drive">
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={smbUrl(personal, principal)}>
                <ExternalLink className="size-4" />
                Open in Finder
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadMacShortcut(personal, principal)}
            >
              <Download className="size-4" />
              Download shortcut
            </Button>
          </div>
          <Note>
            "Open in Finder" asks for the password and connects. The shortcut
            does the same from wherever you keep it — the Desktop works well.
          </Note>
        </Section>

        <Section title="If the button did nothing">
          <Steps>
            <li>
              In Finder, choose <strong>Go → Connect to Server</strong> (or
              press ⌘K).
            </li>
            <li>Paste the address below and press Connect.</li>
            <li>
              Choose <strong>Registered User</strong>, enter the username and
              password above, and tick{" "}
              <strong>Remember this password in my keychain</strong>.
            </li>
          </Steps>
          <div className="flex flex-col gap-1.5 pt-1">
            <Field label={personal.label} value={smbUrl(personal, principal)} />
            <Field label={family.label} value={smbUrl(family, principal)} />
          </div>
        </Section>

        <Section title="Keep it connected">
          <Steps>
            <li>
              Open <strong>System Settings → General → Login Items</strong>.
            </li>
            <li>
              Press <strong>+</strong>, pick the drive under Locations, and add
              it.
            </li>
          </Steps>
          <Note>
            The drive then mounts itself each time you log in. It only works
            while Tailscale is connected — off the network it simply will not
            appear, which is intended.
          </Note>
        </Section>
      </div>
    );
  }

  if (platform === "windows") {
    return (
      <div className="flex flex-col gap-5">
        <Section title="Connect the drives">
          <Button
            className="self-start"
            onClick={() => downloadWindowsShortcut(principal)}
          >
            <Download className="size-4" />
            Download shortcut
          </Button>
          <Steps>
            <li>Open the downloaded file. Windows may ask you to confirm.</li>
            <li>Type the password when the window asks, then press Enter.</li>
            <li>
              Both drives appear under <strong>This PC</strong> and come back
              after every sign-in.
            </li>
          </Steps>
        </Section>

        <Section title="If the shortcut did not run">
          <Steps>
            <li>
              Open File Explorer, right-click <strong>This PC</strong>, and
              choose <strong>Map network drive</strong>.
            </li>
            <li>Put the folder path below into the Folder box.</li>
            <li>
              Tick <strong>Reconnect at sign-in</strong> and{" "}
              <strong>Connect using different credentials</strong>, then press
              Finish.
            </li>
            <li>
              Enter the username and password above and tick{" "}
              <strong>Remember my credentials</strong>.
            </li>
          </Steps>
          <div className="flex flex-col gap-1.5 pt-1">
            <Field label={personal.label} value={uncPath(personal)} />
            <Field label={family.label} value={uncPath(family)} />
          </div>
        </Section>
      </div>
    );
  }

  if (platform === "ios") {
    return (
      <div className="flex flex-col gap-5">
        <Section title="Add the drive in Files">
          <Steps>
            <li>
              Open the <strong>Files</strong> app and go to{" "}
              <strong>Browse</strong>.
            </li>
            <li>
              Tap <strong>⋯</strong> at the top and choose{" "}
              <strong>Connect to Server</strong>.
            </li>
            <li>Paste the address below and tap Connect.</li>
            <li>
              Choose <strong>Registered User</strong> and enter the username and
              password above.
            </li>
          </Steps>
          <div className="flex flex-col gap-1.5 pt-1">
            <Field label="Server" value={`smb://${SMB_HOST}`} />
          </div>
          <Note>
            The server shows both folders — {personal.label} and {family.label}.
            It stays in the Files sidebar under Shared and works whenever
            Tailscale is on.
          </Note>
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Section title="Connect the drive">
        <p className="text-sm text-muted-foreground">
          Use your system's "connect to server" or SMB mount with these
          addresses and the username and password above.
        </p>
        <div className="flex flex-col gap-1.5">
          <Field label={personal.label} value={smbUrl(personal, principal)} />
          <Field label={family.label} value={smbUrl(family, principal)} />
        </div>
      </Section>
      <Advanced>
        <Section title="Linux — mount at boot">
          <Note>
            Put the credentials in a root-only file rather than in fstab, where
            every user on the machine can read them.
          </Note>
          <Field
            label="Credentials"
            value={`printf 'username=%s\\npassword=%s\\n' '${principal}' "$SECRET" | sudo tee /etc/deniz-cloud.cred >/dev/null && sudo chmod 600 /etc/deniz-cloud.cred`}
          />
          <Field
            label="fstab"
            value={`//${SMB_HOST}/${personal.share} /mnt/personal cifs credentials=/etc/deniz-cloud.cred,vers=3.1.1,seal,uid=1000,gid=1000,_netdev,x-systemd.automount,nofail 0 0`}
          />
          <Note>
            <code>x-systemd.automount</code> mounts on first access rather than
            at boot, so a machine that starts before Tailscale is up still boots
            cleanly. <code>nofail</code> keeps a missing network from blocking
            startup entirely.
          </Note>
        </Section>
        <Section title="Tailscale without a login">
          <Field label="Command" value="sudo tailscale up --operator=$USER" />
          <Note>
            Otherwise the tailnet only comes up after someone logs in, so
            anything mounting at boot fails on a cold restart.
          </Note>
        </Section>
      </Advanced>
    </div>
  );
}
