"use client";

import type { CloudAuthClient } from "@repo/cloud-auth-client";
import { CopyButton } from "@repo/ui/copy-button";
import { Skeleton } from "@repo/ui/skeleton";
import { useEffect, useRef, useState } from "react";
import {
  FlowField,
  StepActions,
  StepAlert,
  StepButton,
  StepForm,
  StepHeading,
  TextAction,
} from "./flow-step";
import { transitionStep } from "./flow-transition";
import { OTP_LENGTH, OtpField } from "./otp-field";

// A URI that fails to parse must not throw during render — that would take
// down the page, including the backup codes shown on the next step.
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri.replace("otpauth://", "https://")).searchParams.get(
      "secret",
    );
  } catch {
    return null;
  }
}

const QR_SIZE = 224;

/**
 * Arms TOTP for the signed-in account and hands back the one-time backup
 * codes. `twoFactor.enable` re-checks the password, which is why the caller
 * has to supply it rather than relying on the session alone. Two screens:
 * scan the code, then prove the app has it.
 */
export function TotpEnrollment({
  authClient,
  password,
  onVerified,
  onFailed,
}: {
  authClient: CloudAuthClient;
  password: string;
  onVerified: (backupCodes: string[]) => void;
  onFailed: (message: string) => void;
}) {
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [phase, setPhase] = useState<"scan" | "verify">("scan");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Callers pass inline arrows, so depending on the callback identity would
  // re-run enrollment on every parent render — issuing a fresh secret and new
  // backup codes while the user is mid-scan. The effect keys on the password
  // alone and reaches the latest callback through a ref.
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: enableError } = await authClient.twoFactor.enable({
        password,
      });
      if (!active) return;
      if (enableError || !data || data.method !== "totp") {
        onFailedRef.current(
          enableError?.message ?? "Setting up the authenticator app failed",
        );
        return;
      }
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
    })();
    return () => {
      active = false;
    };
  }, [authClient, password]);

  // `qrcode` is ~50 kB that only enrollment ever needs; importing it here keeps
  // it off the first load of every sign-in. Rendered at 2× and shown at 1× so
  // the modules stay crisp on a retina screen; the palette's own ink and paper
  // keep it scannable in both themes.
  useEffect(() => {
    if (!totpUri) return;
    let active = true;
    void (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const url = await toDataURL(totpUri, {
          margin: 2,
          width: QR_SIZE * 2,
          color: { dark: "#303630", light: "#f9f8f6" },
        });
        if (active) setQrDataUrl(url);
      } catch {
        if (active) setQrDataUrl(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [totpUri]);

  const secret = totpUri ? secretFromUri(totpUri) : null;

  const goToVerify = () => {
    transitionStep(() => {
      setError(null);
      setPhase("verify");
    });
  };
  const goToScan = () => {
    transitionStep(() => {
      setError(null);
      setCode("");
      setPhase("scan");
    });
  };

  const verify = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code: value,
    });
    setBusy(false);
    if (verifyError) {
      setError(
        verifyError.message ??
          "That code didn't match. Wait for the next one and try again.",
      );
      return;
    }
    onVerified(backupCodes);
  };

  if (phase === "verify") {
    return (
      <div className="flex flex-col gap-8">
        <StepHeading lede="Type the six digits the app now shows for this account.">
          Enter the code it shows
        </StepHeading>
        {error ? <StepAlert>{error}</StepAlert> : null}
        <StepForm
          onSubmit={() => {
            if (code.length === OTP_LENGTH) void verify(code);
          }}
        >
          <FlowField id="enroll-code" label="Code">
            <OtpField
              id="enroll-code"
              value={code}
              onChange={setCode}
              onComplete={(complete) => void verify(complete)}
              disabled={busy}
              invalid={Boolean(error)}
              autoFocus
            />
          </FlowField>
          <StepButton
            type="submit"
            busy={busy}
            disabled={code.length < OTP_LENGTH}
          >
            Verify
          </StepButton>
          <StepActions>
            <TextAction disabled={busy} onClick={goToScan}>
              Back to the QR code
            </TextAction>
          </StepActions>
        </StepForm>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="Scan this with an authenticator app — Google Authenticator, 1Password, or the Passwords app on iPhone and Mac. Every sign-in from now on asks for the code it shows.">
        Set up your authenticator app
      </StepHeading>
      {totpUri ? (
        <div className="flex flex-col gap-5">
          {qrDataUrl ? (
            // A data: URI has nothing for next/image to optimise.
            <img
              src={qrDataUrl}
              alt="QR code for your authenticator app"
              width={QR_SIZE}
              height={QR_SIZE}
              className="rounded-md border"
            />
          ) : (
            <Skeleton
              className="rounded-md"
              style={{ width: QR_SIZE, height: QR_SIZE }}
            />
          )}
          {secret ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">
                Can't scan? Enter this key by hand instead.
              </span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border px-3 py-2 font-mono text-sm tracking-wide">
                  {secret}
                </code>
                <CopyButton value={secret} label="Copy the key" />
              </div>
            </div>
          ) : null}
          <StepButton type="button" onClick={goToVerify}>
            Continue
          </StepButton>
        </div>
      ) : (
        <div className="flex flex-col gap-5" aria-busy="true">
          <Skeleton
            className="rounded-md"
            style={{ width: QR_SIZE, height: QR_SIZE }}
          />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}
    </div>
  );
}
