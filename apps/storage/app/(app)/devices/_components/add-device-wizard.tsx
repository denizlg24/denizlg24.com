"use client";

import type { SmbPlatform } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useSession } from "@/components/session-provider";
import { api, errorMessage } from "@/lib/api";
import { TAILNET_PROBE_URL } from "@/lib/env";
import { keys } from "@/lib/folder-cache";
import { ConnectSteps, Credentials } from "./connect-steps";
import {
  detectPlatform,
  PLATFORMS,
  platformInfo,
  TAILSCALE_DOWNLOAD,
} from "./platform";

export interface IssuedDevice {
  id: string;
  deviceName: string;
  principal: string;
  /** Shown once; null when the wizard reopens for an existing device. */
  secret: string | null;
  platform: SmbPlatform;
}

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: "Name it",
  2: "Get on the network",
  3: "Connect the drive",
  4: "Waiting for the connection",
};

const PROBE_INTERVAL_MS = 3_000;
const DEVICE_POLL_MS = 3_000;
const STUCK_AFTER_MS = 2 * 60 * 1_000;

/**
 * Adding a computer, one screen at a time. The honest ceiling: a browser
 * cannot mount a drive or install Tailscale, so each step does what it can
 * — registers the device, opens the system's connect dialog with the
 * address filled in — and the last one watches for the first sign-in so the
 * person is told when it worked rather than left guessing.
 */
export function AddDeviceWizard({
  resume,
  onDone,
  onCancel,
}: {
  /** Reopens at the drive step for a device that already exists. */
  resume?: IssuedDevice;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(resume ? 3 : 1);
  const [issued, setIssued] = useState<IssuedDevice | null>(resume ?? null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {step} of 4
          </p>
          <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
            <X className="size-4" />
            {step < 4 && !resume ? "Cancel" : "Close"}
          </Button>
        </div>
        <ol className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {([1, 2, 3, 4] as const).map((n) => (
            <li
              key={n}
              className={cn(
                "h-1 rounded-full",
                n <= step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </ol>
        <h2 className="text-lg font-semibold tracking-tight">
          {STEP_TITLES[step]}
        </h2>
      </header>

      {step === 1 && (
        <NameStep
          onIssued={(device) => {
            setIssued(device);
            setStep(2);
          }}
        />
      )}
      {step === 2 && issued && (
        <NetworkStep platform={issued.platform} onContinue={() => setStep(3)} />
      )}
      {step === 3 && issued && (
        <div className="flex flex-col gap-5">
          <Credentials principal={issued.principal} secret={issued.secret} />
          <ConnectSteps
            platform={issued.platform}
            principal={issued.principal}
          />
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button onClick={() => setStep(4)}>I've connected it</Button>
            {!resume && (
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
            )}
          </div>
        </div>
      )}
      {step === 4 && issued && (
        <WaitStep
          device={issued}
          onBack={() => setStep(3)}
          onReissued={(device) => {
            setIssued(device);
            setStep(3);
          }}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function NameStep({ onIssued }: { onIssued: (device: IssuedDevice) => void }) {
  const id = useId();
  const { user } = useSession();
  const client = useQueryClient();
  const [platform, setPlatform] = useState<SmbPlatform>("other");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const suggested = `${user.username}'s ${platformInfo(platform).noun}`;
  const deviceName = (touched ? name : suggested).trim();

  const issue = async () => {
    if (!deviceName || busy) return;
    setBusy(true);
    setError(null);
    try {
      const credential = await api.smbCredentials.issue({
        deviceName,
        platform,
      });
      await client.invalidateQueries({ queryKey: keys.devices });
      onIssued({
        deviceName: credential.deviceName,
        id: credential.id,
        platform,
        principal: credential.principal,
        secret: credential.secret,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void issue();
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">What is it?</span>
        <div
          role="radiogroup"
          aria-label="Kind of device"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PLATFORMS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={platform === option.value}
              onClick={() => setPlatform(option.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors",
                platform === option.value
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted/60",
              )}
            >
              <option.icon className="size-5" strokeWidth={1.75} />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`} className="text-sm font-medium">
          What should we call this computer?
        </Label>
        <Input
          id={`${id}-name`}
          value={touched ? name : suggested}
          onChange={(event) => {
            setTouched(true);
            setName(event.target.value);
          }}
          maxLength={255}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Just so you recognise it in the list. You can have up to ten.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="self-start"
        disabled={busy || deviceName.length === 0}
      >
        {busy ? "Adding…" : "Continue"}
      </Button>
    </form>
  );
}

type ProbeState = "idle" | "checking" | "online" | "offline";

function useTailnetProbe(enabled: boolean): ProbeState {
  const [state, setState] = useState<ProbeState>(
    TAILNET_PROBE_URL ? "checking" : "idle",
  );
  useEffect(() => {
    if (!enabled || !TAILNET_PROBE_URL) return;
    const url = TAILNET_PROBE_URL;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      let ok = false;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.timeout(2_500),
        });
        ok = response.ok;
      } catch {
        ok = false;
      }
      if (!active) return;
      setState(ok ? "online" : "offline");
      if (!ok) timer = setTimeout(() => void check(), PROBE_INTERVAL_MS);
    };
    void check();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled]);
  return state;
}

function NetworkStep({
  platform,
  onContinue,
}: {
  platform: SmbPlatform;
  onContinue: () => void;
}) {
  const probe = useTailnetProbe(true);
  const unattended =
    platform === "windows"
      ? "Right-click the Tailscale icon in the system tray and turn on Run unattended"
      : platform === "mac"
        ? "Open Tailscale's settings and turn on Run unattended"
        : platform === "ios"
          ? "Leave the Tailscale VPN switched on in Settings"
          : "Run `sudo tailscale up --operator=$USER` so it starts at boot";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Deniz Cloud is only reachable through Tailscale, and Deniz has to sign
        this computer in himself.
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm marker:text-muted-foreground">
        <li>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Install Tailscale.
            <a
              href={TAILSCALE_DOWNLOAD[platform]}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              Download for {platformInfo(platform).label}
              <ExternalLink className="size-3.5" />
            </a>
          </span>
        </li>
        <li>
          Hand it to Deniz to sign in — or ask him to do it over a screen share.
          It signs in under his account, not yours.
        </li>
        <li>{unattended}, so it stays connected after a restart.</li>
      </ol>

      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
          probe === "online" && "border-status-good/40 bg-status-good/5",
        )}
        role="status"
      >
        {probe === "idle" && (
          <span className="text-muted-foreground">
            When Tailscale shows it is connected, carry on.
          </span>
        )}
        {probe === "checking" && (
          <>
            <Spinner className="size-4" />
            <span className="text-muted-foreground">Checking…</span>
          </>
        )}
        {probe === "online" && (
          <>
            <Check className="size-4 text-status-good" />
            <span>You're on the network.</span>
          </>
        )}
        {probe === "offline" && (
          <>
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="text-muted-foreground">
              Not yet — this checks again every few seconds.
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={onContinue}
          variant={probe === "offline" ? "outline" : "default"}
        >
          {probe === "offline" ? "Continue anyway" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function WaitStep({
  device,
  onBack,
  onReissued,
  onDone,
}: {
  device: IssuedDevice;
  onBack: () => void;
  onReissued: (device: IssuedDevice) => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const devices = useQuery({
    queryKey: keys.devices,
    queryFn: () => api.smbCredentials.list(),
    refetchInterval: DEVICE_POLL_MS,
  });
  const row = devices.data?.find((entry) => entry.id === device.id);
  const connected =
    row !== undefined &&
    (row.connected === true || row.lastAuthenticatedAt !== null);
  const [startedAt] = useState(() => Date.now());
  const [stuck, setStuck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connected) return;
    const timer = setTimeout(
      () => setStuck(true),
      Math.max(0, STUCK_AFTER_MS - (Date.now() - startedAt)),
    );
    return () => clearTimeout(timer);
  }, [connected, startedAt]);

  const reissue = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.smbCredentials.revoke(device.id);
      const fresh = await api.smbCredentials.issue({
        deviceName: device.deviceName,
        platform: device.platform,
      });
      await client.invalidateQueries({ queryKey: keys.devices });
      onReissued({
        deviceName: fresh.deviceName,
        id: fresh.id,
        platform: device.platform,
        principal: fresh.principal,
        secret: fresh.secret,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const where =
    device.platform === "windows"
      ? "under This PC in File Explorer"
      : device.platform === "ios"
        ? "in the Files app under Shared"
        : device.platform === "mac"
          ? "in Finder's sidebar under Locations"
          : "wherever you mounted it";

  if (connected) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-lg border border-status-good/40 bg-status-good/5 p-4">
          <Check className="mt-0.5 size-5 shrink-0 text-status-good" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              Connected
              {row?.lastAuthenticatedFrom &&
                ` from ${row.lastAuthenticatedFrom}`}
            </p>
            <p className="text-sm text-muted-foreground">
              You're done — the drive is {where}.
            </p>
          </div>
        </div>
        <Button className="self-start" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  if (row === undefined && devices.data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          This device was removed, so it can't connect. Add it again to get a
          new password.
        </p>
        <Button variant="outline" className="self-start" onClick={onDone}>
          Back to devices
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
        <Spinner className="size-4" />
        <p className="text-sm text-muted-foreground">
          Watching for {device.deviceName} to sign in. This updates on its own —
          no need to refresh.
        </p>
      </div>

      {stuck && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">
            Nothing yet after two minutes. The usual reasons:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>
              Tailscale isn't signed in on that computer, or isn't switched on.
              Its icon should say Connected.
            </li>
            <li>
              The password was mistyped. It can't be shown again, but{" "}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void reissue()}
              >
                {busy ? "making a new one…" : "make a new one"}
              </button>{" "}
              and try again.
            </li>
            <li>
              The address was typed by hand and has a typo — go back and copy it
              instead.
            </li>
          </ul>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onBack}>
          Back to the drive step
        </Button>
        <Button variant="ghost" onClick={onDone}>
          I'll finish later
        </Button>
      </div>
    </div>
  );
}
