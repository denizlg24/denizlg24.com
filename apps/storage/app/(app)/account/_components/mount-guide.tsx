"use client";

import { CopyButton } from "@repo/ui/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ReactNode } from "react";

/**
 * Setup instructions.
 *
 * This is the one place in the product that carries explanatory copy. The
 * usual rule — the owner built it, so the UI assumes full context — stops
 * holding here: the drives are handed to people who did not build any of this
 * and will follow the steps once, on their own machine, without help. Every
 * step names what to click rather than what to type.
 */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate rounded-sm bg-muted/50 px-2 py-1 font-mono text-xs">
        {value}
      </code>
      <CopyButton value={value} label={`Copy ${label}`} />
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm marker:text-muted-foreground">
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

export function MountGuide({
  host,
  personalUrl,
  sharedUrl,
  principal,
}: {
  host: string;
  personalUrl: string;
  sharedUrl: string;
  principal: string | null;
}) {
  const user = principal ?? "the username shown when you add a device";

  return (
    <Tabs defaultValue="simple">
      <TabsList variant="line">
        <TabsTrigger value="simple">Mac</TabsTrigger>
        <TabsTrigger value="windows">Windows</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>

      <TabsContent value="simple" className="flex flex-col gap-5 pt-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">1. Connect to the network</span>
          <Steps>
            <li>
              Install Tailscale from the App Store and sign in with the account
              you were invited with.
            </li>
            <li>
              Open Tailscale&apos;s settings and turn on{" "}
              <strong>Run unattended</strong>. Without it the drive disappears
              whenever the Mac restarts and nobody is logged in yet.
            </li>
          </Steps>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">2. Add the drive</span>
          <Steps>
            <li>
              In Finder, choose <strong>Go → Connect to Server</strong> (or
              press ⌘K).
            </li>
            <li>Paste the address below and press Connect.</li>
            <li>
              Choose <strong>Registered User</strong>, enter the username and
              password from the device you added, and tick{" "}
              <strong>Remember this password in my keychain</strong>.
            </li>
          </Steps>
          <div className="flex flex-col gap-1 pt-1">
            <Field label="Your files" value={personalUrl} />
            <Field label="Shared" value={sharedUrl} />
            <Field label="Username" value={user} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">
            3. Reconnect automatically
          </span>
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
            The drive now mounts itself each time you log in. It only works
            while Tailscale is connected — off the network it simply will not
            appear, which is intended.
          </Note>
        </div>
      </TabsContent>

      <TabsContent value="windows" className="flex flex-col gap-5 pt-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">1. Connect to the network</span>
          <Steps>
            <li>
              Install Tailscale from tailscale.com and sign in with the account
              you were invited with.
            </li>
            <li>
              Right-click the Tailscale icon in the system tray and turn on{" "}
              <strong>Run unattended</strong>, so the drive is there after a
              restart.
            </li>
          </Steps>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">2. Add the drive</span>
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
              Enter the username and password from the device you added and tick{" "}
              <strong>Remember my credentials</strong>.
            </li>
          </Steps>
          <div className="flex flex-col gap-1 pt-1">
            <Field label="Your files" value={`\\\\${host}\\Personal`} />
            <Field label="Shared" value={`\\\\${host}\\Shared`} />
            <Field label="Username" value={user} />
          </div>
        </div>

        <Note>
          Reconnect at sign-in makes Windows mount it every time you log in. It
          only works while Tailscale is connected.
        </Note>
      </TabsContent>

      <TabsContent value="advanced" className="flex flex-col gap-4 pt-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Linux — mount at boot</span>
          <Note>
            Put the credentials in a root-only file rather than in fstab, where
            every user on the machine can read them.
          </Note>
          <Field
            label="credentials"
            value={`printf 'username=%s\\npassword=%s\\n' "$USER_PRINCIPAL" "$SECRET" | sudo tee /etc/deniz-cloud.cred >/dev/null && sudo chmod 600 /etc/deniz-cloud.cred`}
          />
          <Field
            label="fstab"
            value={`//${host}/Personal /mnt/personal cifs credentials=/etc/deniz-cloud.cred,vers=3.1.1,seal,uid=1000,gid=1000,_netdev,x-systemd.automount,nofail 0 0`}
          />
          <Note>
            <code>x-systemd.automount</code> mounts on first access rather than
            at boot, so a machine that starts before Tailscale is up still boots
            cleanly. <code>nofail</code> keeps a missing network from blocking
            startup entirely.
          </Note>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Tailscale unattended</span>
          <Field
            label="Linux — connect at boot without a login"
            value="sudo tailscale up --operator=$USER"
          />
          <Note>
            On macOS and Windows this is the <strong>Run unattended</strong>{" "}
            toggle. Without it the tailnet only comes up after someone logs in,
            so anything mounting at boot fails on a cold restart.
          </Note>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Why it may not appear</span>
          <Note>
            The drives are reachable over the tailnet only — port 445 is not
            exposed to the internet or the local network. If a device cannot see
            them, Tailscale is disconnected, the device credential was revoked,
            or the storage host has withdrawn the share after a fault.
          </Note>
        </div>
      </TabsContent>
    </Tabs>
  );
}
