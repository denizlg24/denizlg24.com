"use client";

import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useState } from "react";
import {
  FlowField,
  flowControlClass,
  StepActions,
  StepAlert,
  StepButton,
  StepForm,
  StepHeading,
  TextAction,
} from "./flow-step";
import { OTP_LENGTH, OtpField } from "./otp-field";

export type SecondFactorMode = "totp" | "backup";

export function SecondFactorStep({
  busy,
  error,
  trustDevice,
  onSubmit,
  onModeChange,
  onBack,
}: {
  busy: boolean;
  error?: string | null;
  trustDevice: { checked: boolean; onChange: (checked: boolean) => void };
  onSubmit: (code: string, mode: SecondFactorMode) => void;
  onModeChange?: (mode: SecondFactorMode) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<SecondFactorMode>("totp");
  const [code, setCode] = useState("");

  const switchMode = () => {
    const next: SecondFactorMode = mode === "totp" ? "backup" : "totp";
    setMode(next);
    setCode("");
    onModeChange?.(next);
  };

  const ready =
    mode === "totp" ? code.length === OTP_LENGTH : code.trim().length > 0;
  const submit = () => {
    if (ready && !busy) onSubmit(code.trim(), mode);
  };

  return (
    <div className="flex flex-col gap-8">
      <StepHeading
        lede={
          mode === "totp"
            ? "The six-digit code changes every 30 seconds."
            : "A backup code works once. You got them when you set up your authenticator app."
        }
      >
        {mode === "totp"
          ? "Enter the code from your authenticator app"
          : "Enter a backup code"}
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm onSubmit={submit}>
        {mode === "totp" ? (
          <FlowField id="totp-code" label="Code">
            <OtpField
              id="totp-code"
              value={code}
              onChange={setCode}
              onComplete={(complete) => {
                if (!busy) onSubmit(complete, "totp");
              }}
              disabled={busy}
              invalid={Boolean(error)}
              autoFocus
            />
          </FlowField>
        ) : (
          <FlowField id="backup-code" label="Backup code">
            <Input
              id="backup-code"
              name="backup-code"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              aria-invalid={error ? true : undefined}
              className={`${flowControlClass} font-mono`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FlowField>
        )}
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="trust-device"
            checked={trustDevice.checked}
            onCheckedChange={(checked) =>
              trustDevice.onChange(checked === true)
            }
          />
          <Label htmlFor="trust-device" className="text-sm font-normal">
            Trust this device
            <span className="text-muted-foreground">
              — skip the code here next time
            </span>
          </Label>
        </div>
        <StepButton type="submit" busy={busy} disabled={!ready}>
          Verify
        </StepButton>
        <StepActions>
          <TextAction disabled={busy} onClick={switchMode}>
            {mode === "totp"
              ? "Use a backup code instead"
              : "Use your authenticator app instead"}
          </TextAction>
          <TextAction disabled={busy} onClick={onBack}>
            Back
          </TextAction>
        </StepActions>
      </StepForm>
    </div>
  );
}
