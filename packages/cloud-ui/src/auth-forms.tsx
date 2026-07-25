"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { type FormEvent, type ReactNode, useState } from "react";

function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-xs text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

export function CredentialsForm({
  defaultUsername = "",
  busy,
  onSubmit,
  onSignupRequested,
}: {
  defaultUsername?: string;
  busy: boolean;
  onSubmit: (values: {
    username: string;
    password: string;
  }) => void | Promise<void>;
  onSignupRequested?: () => void;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ username, password });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username" className="text-xs">
          Username
        </Label>
        <Input
          id="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-xs">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !username || !password}>
        Sign in
      </Button>
      {onSignupRequested && (
        <LinkButton onClick={onSignupRequested}>
          Redeem a signup token
        </LinkButton>
      )}
    </form>
  );
}

export function SignupForm({
  defaultUsername = "",
  defaultToken = "",
  busy,
  onSubmit,
  onBack,
}: {
  defaultUsername?: string;
  defaultToken?: string;
  busy: boolean;
  onSubmit: (values: {
    username: string;
    email: string;
    password: string;
    token: string;
  }) => void | Promise<void>;
  onBack?: () => void;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(defaultToken);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ username, email, password, token });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-username" className="text-xs">
          Username
        </Label>
        <Input
          id="signup-username"
          autoComplete="username"
          autoFocus={!defaultToken}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email" className="text-xs">
          Email
        </Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          autoFocus={Boolean(defaultToken)}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password" className="text-xs">
          Password
        </Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-token" className="text-xs">
          Signup token
        </Label>
        <Input
          id="signup-token"
          className="font-mono"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={
          busy ||
          !username ||
          !email ||
          password.length < MIN_PASSWORD_LENGTH ||
          !token
        }
      >
        Continue
      </Button>
      {onBack && <LinkButton onClick={onBack}>Back to sign in</LinkButton>}
    </form>
  );
}

export type ChallengeMode = "totp" | "recovery";

export function CodeChallengeForm({
  busy,
  onSubmit,
  onModeChange,
}: {
  busy: boolean;
  onSubmit: (code: string, mode: ChallengeMode) => void | Promise<void>;
  onModeChange?: (mode: ChallengeMode) => void;
}) {
  const [mode, setMode] = useState<ChallengeMode>("totp");
  const [code, setCode] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(code, mode);
  };

  const switchMode = () => {
    const next: ChallengeMode = mode === "totp" ? "recovery" : "totp";
    setMode(next);
    setCode("");
    onModeChange?.(next);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code" className="text-xs">
          {mode === "totp" ? "TOTP code" : "Recovery code"}
        </Label>
        <Input
          id="code"
          autoFocus
          inputMode={mode === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          maxLength={mode === "totp" ? 6 : undefined}
          className={
            mode === "totp" ? "font-mono tracking-widest" : "font-mono"
          }
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={busy || code.length < (mode === "totp" ? 6 : 1)}
      >
        Verify
      </Button>
      <LinkButton onClick={switchMode}>
        {mode === "totp" ? "Use a recovery code" : "Back to TOTP"}
      </LinkButton>
    </form>
  );
}
