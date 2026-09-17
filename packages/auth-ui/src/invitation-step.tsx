"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
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

export interface InvitationValues {
  username: string;
  email: string;
  password: string;
  token: string;
}

/**
 * The one screen that asks several things at once: it is one question — set
 * up your account — and is seen once per person.
 */
export function InvitationStep({
  defaultUsername = "",
  defaultToken = "",
  busy,
  error,
  onSubmit,
  onBack,
}: {
  defaultUsername?: string;
  defaultToken?: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (values: InvitationValues) => void;
  onBack: () => void;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(defaultToken);

  const ready =
    username.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    token.trim().length > 0;

  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="Use the invitation you were sent. You'll set up an authenticator app right after.">
        Set up your account
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm
        onSubmit={() =>
          onSubmit({
            username: username.trim(),
            email: email.trim(),
            password,
            token: token.trim(),
          })
        }
      >
        <FlowField id="invitation-token" label="Invitation code">
          <Input
            id="invitation-token"
            name="token"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!defaultToken}
            required
            className={`${flowControlClass} font-mono`}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </FlowField>
        <FlowField id="invitation-username" label="Username">
          <Input
            id="invitation-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={Boolean(defaultToken)}
            required
            className={flowControlClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FlowField>
        <FlowField id="invitation-email" label="Email">
          <Input
            id="invitation-email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            className={flowControlClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FlowField>
        <FlowField
          id="invitation-password"
          label="Password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          <Input
            id="invitation-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            aria-describedby="invitation-password-hint"
            className={flowControlClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FlowField>
        <StepButton type="submit" busy={busy} disabled={!ready}>
          Continue
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
