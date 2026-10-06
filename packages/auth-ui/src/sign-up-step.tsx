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

export interface SignUpValues {
  name: string;
  email: string;
  password: string;
}

/**
 * Creating a deniz account to use one app. One question — who are you — and
 * the app's name says why it is being asked.
 */
export function SignUpStep({
  appName,
  defaultEmail = "",
  busy,
  error,
  challenge,
  challengeReady,
  legal,
  onSubmit,
  onSignIn,
}: {
  appName: string;
  defaultEmail?: string;
  busy: boolean;
  error?: string | null;
  /** The bot check, rendered under the fields. */
  challenge?: ReactNode;
  /** False until the bot check has produced a token. */
  challengeReady: boolean;
  /** The app's terms and privacy links, when it has them. */
  legal?: ReactNode;
  onSubmit: (values: SignUpValues) => void;
  onSignIn: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const ready =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    challengeReady;

  return (
    <div className="flex flex-col gap-8">
      <StepHeading
        lede={`One account works for ${appName} and any other app that signs in with deniz.`}
      >
        Create your account
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <StepForm
        onSubmit={() =>
          onSubmit({ name: name.trim(), email: email.trim(), password })
        }
      >
        <FlowField id="name" label="Your name">
          <Input
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            required
            className={flowControlClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FlowField>
        <FlowField
          id="email"
          label="Email"
          hint="We'll send a link to confirm it's yours."
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            className={flowControlClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FlowField>
        <FlowField
          id="new-password"
          label="Password"
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
            required
            minLength={MIN_PASSWORD_LENGTH}
            className={flowControlClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FlowField>
        {challenge}
        {legal ? (
          <p className="text-xs text-muted-foreground">{legal}</p>
        ) : null}
        <StepButton type="submit" busy={busy} disabled={!ready}>
          Create account
        </StepButton>
        <StepActions>
          <TextAction disabled={busy} onClick={onSignIn}>
            Already have an account? Sign in
          </TextAction>
        </StepActions>
      </StepForm>
    </div>
  );
}
