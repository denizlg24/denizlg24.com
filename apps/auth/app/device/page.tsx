"use client";

import { destinationFromClient } from "@repo/auth-ui/destination";
import { FlowFrame } from "@repo/auth-ui/flow-frame";
import {
  FlowField,
  flowControlClass,
  StepActions,
  StepAlert,
  StepButton,
  StepForm,
  StepHeading,
} from "@repo/auth-ui/flow-step";
import { CheckingStep, FlowMessage } from "@repo/auth-ui/status-step";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { PublicTenant } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { loginHref } from "@/components/session-gate";
import { api, isApiError } from "@/lib/api";

type Phase =
  | { step: "checking" }
  | { step: "enter"; error: string | null }
  | {
      step: "confirm";
      userCode: string;
      app: { name: string; host: string | null; clientId: string };
      error: string | null;
    }
  | { step: "approved"; appName: string }
  | { step: "denied"; appName: string };

/** `abcd efgh`, `ABCD-EFGH` and `abcdefgh` are the same code. */
function normalizeCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function displayCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function codeError(error: unknown): string {
  if (!isApiError(error)) {
    return "Something went wrong. Try again.";
  }
  switch (error.code) {
    case "NETWORK":
      return error.message;
    case "expired_token":
      return "That code has expired. Ask the TV for a new one and enter it here.";
    case "invalid_request":
      return "That code didn't match a device. Check it against the TV and try again.";
    default:
      return error.message;
  }
}

function DeviceFlow() {
  const searchParams = useSearchParams();
  const linkedCode = normalizeCode(searchParams.get("user_code") ?? "");

  const [phase, setPhase] = useState<Phase>({ step: "checking" });
  const [account, setAccount] = useState<string | null>(null);
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const lookUp = useCallback(async (userCode: string) => {
    setBusy(true);
    try {
      const request = await api.verifyDevice(userCode);
      if (request.status !== "pending" || !request.client_id) {
        setPhase({
          step: "enter",
          error:
            "That code has already been used. If the TV still shows a code, enter the one it shows now.",
        });
        return;
      }
      const clientId = request.client_id;
      const [client, found] = await Promise.all([
        api.publicClient(clientId).catch(() => null),
        api.publicTenant(clientId).catch(() => null),
      ]);
      setTenant(found);
      const named = destinationFromClient(clientId, client);
      setPhase({
        step: "confirm",
        userCode,
        app: { name: found?.name ?? named.name, host: named.host, clientId },
        error: null,
      });
    } catch (error) {
      setPhase({ step: "enter", error: codeError(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  // Approving needs to know who is signed in on this browser; a link from the
  // TV's QR code comes back here with its code once they have.
  useEffect(() => {
    let active = true;
    void api
      .account()
      .then((summary) => {
        if (!active) return;
        setAccount(summary.username ?? summary.email);
        if (linkedCode) void lookUp(linkedCode);
        else setPhase({ step: "enter", error: null });
      })
      .catch((error) => {
        if (!active) return;
        if (isApiError(error) && error.status === 401) {
          window.location.replace(loginHref(window.location.href));
          return;
        }
        setPhase({
          step: "enter",
          error:
            "We couldn't check who's signed in. Reload the page to try again.",
        });
      });
    return () => {
      active = false;
    };
  }, [linkedCode, lookUp]);

  const decide = async (approve: boolean) => {
    if (phase.step !== "confirm") return;
    setBusy(true);
    try {
      await api.decideDevice(phase.userCode, approve);
      setPhase({
        step: approve ? "approved" : "denied",
        appName: phase.app.name,
      });
    } catch (error) {
      setPhase({ ...phase, error: codeError(error) });
    } finally {
      setBusy(false);
    }
  };

  const signOutHref = `/logout?returnTo=${encodeURIComponent(
    typeof window === "undefined" ? "/device" : window.location.href,
  )}`;

  return (
    <FlowFrame
      destination={
        phase.step === "confirm"
          ? {
              name: phase.app.name,
              host: phase.app.host,
              clientId: phase.app.clientId,
            }
          : phase.step === "checking"
            ? "pending"
            : null
      }
      app={tenant ? { name: tenant.name, logoUrl: tenant.logoUrl } : null}
      themeToggle={<ThemeToggle />}
    >
      {phase.step === "checking" ? <CheckingStep /> : null}

      {phase.step === "enter" ? (
        <div className="flex flex-col gap-8">
          <StepHeading lede="Your TV shows a code when you choose to sign in on it. Type it here to connect the TV to your account.">
            Enter the code from your TV
          </StepHeading>
          {phase.error ? <StepAlert>{phase.error}</StepAlert> : null}
          <StepForm onSubmit={() => void lookUp(normalizeCode(typed))}>
            <FlowField
              id="user-code"
              label="Code"
              hint="Letters and numbers. Upper or lower case both work."
            >
              <Input
                id="user-code"
                name="user-code"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                placeholder="ABCD-EFGH"
                className={`${flowControlClass} font-mono tracking-widest uppercase`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </FlowField>
            <StepButton
              type="submit"
              busy={busy}
              disabled={normalizeCode(typed).length === 0}
            >
              Continue
            </StepButton>
            {account ? (
              <StepActions>
                <a
                  href={signOutHref}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-accent-strong hover:underline"
                >
                  Signed in as {account}. Not you? Sign out
                </a>
              </StepActions>
            ) : null}
          </StepForm>
        </div>
      ) : null}

      {phase.step === "confirm" ? (
        <div className="flex flex-col gap-8">
          <StepHeading
            lede={`Check that your TV shows ${displayCode(phase.userCode)}. If it doesn't, choose Don't connect.`}
          >
            Sign in to {phase.app.name} on your TV?
          </StepHeading>
          {phase.error ? <StepAlert>{phase.error}</StepAlert> : null}
          <dl className="flex flex-col divide-y border-y text-sm">
            <div className="grid grid-cols-[6rem_1fr] gap-3 py-3">
              <dt className="text-muted-foreground">Code</dt>
              <dd className="font-mono tracking-widest text-accent-strong">
                {displayCode(phase.userCode)}
              </dd>
            </div>
            {account ? (
              <div className="grid grid-cols-[6rem_1fr] gap-3 py-3">
                <dt className="text-muted-foreground">As</dt>
                <dd className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-accent-strong">
                    {account}
                  </span>
                  <a
                    href={signOutHref}
                    className="text-muted-foreground underline-offset-4 hover:text-accent-strong hover:underline"
                  >
                    Not you? Sign out
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="grid grid-cols-2 gap-3">
            <StepButton
              type="button"
              busy={busy}
              onClick={() => void decide(true)}
            >
              Connect
            </StepButton>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 text-base"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Don't connect
            </Button>
          </div>
        </div>
      ) : null}

      {phase.step === "approved" ? (
        <FlowMessage
          title="Your TV is connected"
          detail={`${phase.appName} will open on the TV in a few seconds. You can close this page.`}
        />
      ) : null}

      {phase.step === "denied" ? (
        <FlowMessage
          title="The TV wasn't connected"
          detail={`Nothing changed. To sign in to ${phase.appName} later, choose Sign in on the TV again.`}
        />
      ) : null}
    </FlowFrame>
  );
}

export default function DevicePage() {
  return (
    <Suspense
      fallback={
        <FlowFrame destination="pending" themeToggle={<ThemeToggle />}>
          <CheckingStep />
        </FlowFrame>
      }
    >
      <DeviceFlow />
    </Suspense>
  );
}
