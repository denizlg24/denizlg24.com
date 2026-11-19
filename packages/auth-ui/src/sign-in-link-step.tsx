"use client";

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

/** Asks where to send a one-time sign-in link. */
export function SignInLinkStep({
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
      <StepHeading lede="Enter the email address on your account and we'll send you a link that signs you in — no password needed.">
        Email me a sign-in link
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm onSubmit={() => onSubmit(trimmed)}>
        <FlowField id="sign-in-link-email" label="Email">
          <Input
            id="sign-in-link-email"
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
