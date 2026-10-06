"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
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

/** Asks where to send the reset link. */
export function ForgotPasswordStep({
  defaultEmail = "",
  busy,
  error,
  challenge,
  challengeReady,
  onSubmit,
  onBack,
}: {
  defaultEmail?: string;
  busy: boolean;
  error?: string | null;
  challenge?: ReactNode;
  challengeReady: boolean;
  onSubmit: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const trimmed = email.trim();

  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="Enter the email address on your account and we'll send you a link to choose a new password.">
        Reset your password
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm onSubmit={() => onSubmit(trimmed)}>
        <FlowField id="reset-email" label="Email">
          <Input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            className={flowControlClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FlowField>
        {challenge}
        <StepButton
          type="submit"
          busy={busy}
          disabled={trimmed.length === 0 || !challengeReady}
        >
          Send link
        </StepButton>
        <StepActions>
          <TextAction disabled={busy} onClick={onBack}>
            Back to sign in
          </TextAction>
        </StepActions>
      </StepForm>
    </div>
  );
}

/** Chooses the new password, from the link in the email. */
export function NewPasswordStep({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error?: string | null;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="You'll use it the next time you sign in. Anywhere you're signed in now will be signed out.">
        Choose a new password
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm onSubmit={() => onSubmit(password)}>
        <FlowField
          id="new-password"
          label="New password"
          error={
            tooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null
          }
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          <Input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            className={flowControlClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FlowField>
        <FlowField
          id="confirm-password"
          label="Type it again"
          error={mismatch ? "The two passwords don't match." : null}
        >
          <Input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            className={flowControlClass}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </FlowField>
        <StepButton type="submit" busy={busy} disabled={!ready}>
          Save password
        </StepButton>
      </StepForm>
    </div>
  );
}

/**
 * After something was mailed: where it went, what to do with it, and a way to
 * send it again. The address is the one the visitor typed — the server never
 * says whether it has an account.
 */
export function CheckEmailStep({
  title,
  email,
  detail,
  busy,
  error,
  notice,
  challenge,
  onResend,
  resendReady = true,
  onContinue,
  continueLabel,
  onBack,
  backLabel = "Back to sign in",
}: {
  title: ReactNode;
  email: string | null;
  detail: ReactNode;
  busy: boolean;
  error?: string | null;
  notice?: string | null;
  challenge?: ReactNode;
  onResend?: () => void;
  resendReady?: boolean;
  /** "I've confirmed it": resume without waiting on this tab. */
  onContinue?: () => void;
  continueLabel?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-8" role="status">
      <StepHeading
        lede={
          email ? (
            <>
              We sent it to{" "}
              <span className="font-medium text-accent-strong">{email}</span>.
            </>
          ) : undefined
        }
      >
        {title}
      </StepHeading>
      {error ? (
        <StepAlert>{error}</StepAlert>
      ) : notice ? (
        <StepAlert tone="notice">{notice}</StepAlert>
      ) : null}
      <p className="text-sm text-muted-foreground">{detail}</p>
      {challenge}
      {onContinue ? (
        <StepButton type="button" busy={busy} onClick={onContinue}>
          {continueLabel ?? "Continue"}
        </StepButton>
      ) : null}
      <StepActions>
        {onResend ? (
          <TextAction disabled={busy || !resendReady} onClick={onResend}>
            Send it again
          </TextAction>
        ) : null}
        {onBack ? (
          <TextAction disabled={busy} onClick={onBack}>
            {backLabel}
          </TextAction>
        ) : null}
      </StepActions>
    </div>
  );
}
