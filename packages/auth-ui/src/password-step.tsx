"use client";

import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { type ReactNode, useState } from "react";
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

export function PasswordStep({
  username,
  defaultPassword = "",
  busy,
  error,
  rememberMe,
  onContinue,
  onPasskey,
  onBack,
  onForgotPassword,
  notice,
  heading,
}: {
  username: string;
  /** Restored when the visitor comes back from the second factor. */
  defaultPassword?: string;
  busy: boolean;
  error?: string | null;
  rememberMe: { checked: boolean; onChange: (checked: boolean) => void };
  onContinue: (password: string) => void;
  onPasskey?: () => void;
  onBack: () => void;
  /** Only where a reset by email exists: public accounts of someone else's app. */
  onForgotPassword?: () => void;
  /** Why the password is being asked for again, when it is not a sign-in. */
  notice?: ReactNode;
  heading?: ReactNode;
}) {
  const [password, setPassword] = useState(defaultPassword);

  return (
    <div className="flex flex-col gap-8">
      <StepHeading
        aside={
          <TextAction className="h-auto" onClick={onBack}>
            Not you?
          </TextAction>
        }
      >
        {heading ?? `Welcome back, ${username}`}
      </StepHeading>
      {error ? (
        <StepAlert>{error}</StepAlert>
      ) : notice ? (
        <StepAlert tone="notice">{notice}</StepAlert>
      ) : null}
      <StepForm onSubmit={() => onContinue(password)}>
        {/* Password managers pair the password with the username field of the
            same form; the question was answered a step ago, so it rides along
            hidden. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <FlowField id="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className={flowControlClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FlowField>
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="remember-me"
            checked={rememberMe.checked}
            onCheckedChange={(checked) => rememberMe.onChange(checked === true)}
          />
          <Label htmlFor="remember-me" className="text-sm font-normal">
            Remember me on this device
          </Label>
        </div>
        <StepButton type="submit" busy={busy} disabled={password.length === 0}>
          Continue
        </StepButton>
        <StepActions>
          {onForgotPassword ? (
            <TextAction disabled={busy} onClick={onForgotPassword}>
              Forgot your password?
            </TextAction>
          ) : null}
          {onPasskey ? (
            <TextAction disabled={busy} onClick={onPasskey}>
              Use a passkey instead
            </TextAction>
          ) : null}
        </StepActions>
      </StepForm>
    </div>
  );
}
