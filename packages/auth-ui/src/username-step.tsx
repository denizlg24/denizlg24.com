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

export function UsernameStep({
  defaultUsername = "",
  busy,
  error,
  notice,
  onContinue,
  onPasskey,
  onInvitation,
}: {
  defaultUsername?: string;
  busy: boolean;
  error?: string | null;
  /** Why the visitor is here, when an app sent them back: shown as a notice. */
  notice?: ReactNode;
  onContinue: (username: string) => void;
  /** The username field is marked for conditional mediation when this is set. */
  onPasskey?: () => void;
  onInvitation?: () => void;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const trimmed = username.trim();

  return (
    <div className="flex flex-col gap-8">
      <StepHeading>Who's signing in?</StepHeading>
      {error ? (
        <StepAlert>{error}</StepAlert>
      ) : notice ? (
        <StepAlert tone="notice">{notice}</StepAlert>
      ) : null}
      <StepForm onSubmit={() => onContinue(trimmed)}>
        <FlowField id="username" label="Username">
          <Input
            id="username"
            name="username"
            autoComplete={onPasskey ? "username webauthn" : "username"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            className={flowControlClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FlowField>
        <StepButton type="submit" busy={busy} disabled={trimmed.length === 0}>
          Continue
        </StepButton>
        <StepActions>
          {onPasskey ? (
            <TextAction disabled={busy} onClick={onPasskey}>
              Use a passkey instead
            </TextAction>
          ) : null}
          {onInvitation ? (
            <TextAction disabled={busy} onClick={onInvitation}>
              Have an invitation?
            </TextAction>
          ) : null}
        </StepActions>
      </StepForm>
    </div>
  );
}
