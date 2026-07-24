"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Step = "credentials" | "signup" | "totp" | "recovery";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const next = searchParams.get("next");

  const [step, setStep] = useState<Step>(tokenParam ? "signup" : "credentials");
  const [username, setUsername] = useState(searchParams.get("username") ?? "");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [signupToken, setSignupToken] = useState(tokenParam ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const goToApp = () => router.replace(next?.startsWith("/") ? next : "/");

  // The enrollment page needs the password again to arm TOTP, so it is handed
  // over in memory rather than asked for twice.
  const goToEnrollment = () => {
    sessionStorage.setItem("storage:enroll-password", password);
    router.replace("/setup-mfa");
  };

  const finish = async () => {
    try {
      await api.me();
      goToApp();
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_ENROLLMENT_REQUIRED") {
        goToEnrollment();
        return;
      }
      setError(errorMessage(err));
    }
  };

  const submitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: signInError } = await authClient.signIn.username({
      username,
      password,
    });
    if (signInError) {
      setBusy(false);
      setError(signInError.message ?? "That username or password is not right");
      return;
    }
    if (data && "twoFactorRedirect" in data) {
      setBusy(false);
      setCode("");
      setStep("totp");
      return;
    }
    await finish();
    setBusy(false);
  };

  const submitSignup = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.completeSignup({
        username,
        email,
        password,
        token: signupToken,
      });
      goToEnrollment();
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const verify =
      step === "recovery"
        ? authClient.twoFactor.verifyBackupCode({ code })
        : authClient.twoFactor.verifyTotp({ code });
    const { error: verifyError } = await verify;
    if (verifyError) {
      setBusy(false);
      setError(
        verifyError.message ??
          (step === "recovery"
            ? "That recovery code did not work"
            : "That code did not work — check your authenticator and try again"),
      );
      return;
    }
    await finish();
    setBusy(false);
  };

  return (
    <AuthShell
      title={
        step === "signup"
          ? "Set up your account"
          : step === "totp"
            ? "Two-factor code"
            : step === "recovery"
              ? "Use a recovery code"
              : "Sign in"
      }
      subtitle={
        step === "signup"
          ? "Use the signup link you were sent to pick your username and password."
          : step === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : step === "recovery"
              ? "Enter one of the recovery codes you saved when you set up two-factor."
              : undefined
      }
      error={error}
    >
      {step === "credentials" && (
        <form onSubmit={submitCredentials} className="flex flex-col gap-4">
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
          <button
            type="button"
            className="text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setError(null);
              setStep("signup");
            }}
          >
            I have a signup link
          </button>
        </form>
      )}

      {step === "signup" && (
        <form onSubmit={submitSignup} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-username" className="text-xs">
              Username
            </Label>
            <Input
              id="signup-username"
              autoComplete="username"
              autoFocus={!tokenParam}
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
              autoFocus={Boolean(tokenParam)}
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
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-token" className="text-xs">
              Signup code
            </Label>
            <Input
              id="signup-token"
              className="font-mono"
              value={signupToken}
              onChange={(event) => setSignupToken(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={
              busy || !username || !email || password.length < 8 || !signupToken
            }
          >
            Continue
          </Button>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setError(null);
              setStep("credentials");
            }}
          >
            Back to sign in
          </button>
        </form>
      )}

      {(step === "totp" || step === "recovery") && (
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code" className="text-xs">
              {step === "totp" ? "Authenticator code" : "Recovery code"}
            </Label>
            <Input
              id="code"
              autoFocus
              inputMode={step === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              maxLength={step === "totp" ? 6 : undefined}
              className={
                step === "totp" ? "font-mono tracking-widest" : "font-mono"
              }
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={busy || code.length < (step === "totp" ? 6 : 1)}
          >
            Verify
          </Button>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setCode("");
              setError(null);
              setStep(step === "totp" ? "recovery" : "totp");
            }}
          >
            {step === "totp"
              ? "Lost your phone? Use a recovery code"
              : "Back to authenticator code"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
