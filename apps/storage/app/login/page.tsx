"use client";

import {
  CodeChallengeForm,
  CredentialsForm,
  SignupForm,
} from "@repo/cloud-ui/auth-forms";
import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { stashEnrollPassword } from "@/lib/enroll-handoff";

type Step = "credentials" | "signup" | "challenge";

const TITLES: Record<Step, string> = {
  credentials: "Sign in",
  signup: "Redeem signup token",
  challenge: "Two-factor",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const next = searchParams.get("next");

  const [step, setStep] = useState<Step>(tokenParam ? "signup" : "credentials");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `//evil.com` and `/\evil.com` both start with "/" but resolve to another
  // origin, which would hand a freshly authenticated user to an attacker.
  const safeNext =
    next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
      ? next
      : "/";

  // The enrollment page needs the password again to arm TOTP, so it is handed
  // over in memory rather than asked for twice.
  const goToEnrollment = (password: string) => {
    stashEnrollPassword(password);
    router.replace("/setup-mfa");
  };

  const finish = async (password: string) => {
    try {
      await api.me();
      router.replace(safeNext);
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_ENROLLMENT_REQUIRED") {
        goToEnrollment(password);
        return;
      }
      setError(errorMessage(err));
    }
  };

  const submitCredentials = async (values: {
    username: string;
    password: string;
  }) => {
    setBusy(true);
    setError(null);
    const { data, error: signInError } =
      await authClient.signIn.username(values);
    if (signInError) {
      setBusy(false);
      setError(signInError.message ?? "Sign in failed");
      return;
    }
    if (data && "twoFactorRedirect" in data) {
      setBusy(false);
      setStep("challenge");
      return;
    }
    await finish(values.password);
    setBusy(false);
  };

  const submitSignup = async (values: {
    username: string;
    email: string;
    password: string;
    token: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      await api.completeSignup(values);
      goToEnrollment(values.password);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const submitChallenge = async (code: string, mode: "totp" | "recovery") => {
    setBusy(true);
    setError(null);
    const { error: verifyError } =
      mode === "recovery"
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      setBusy(false);
      setError(verifyError.message ?? "Invalid code");
      return;
    }
    // Enrollment is already complete on this path, so the password is not
    // needed again — /api/me either succeeds or surfaces its own error.
    await finish("");
    setBusy(false);
  };

  return (
    <AuthShell title={TITLES[step]} error={error}>
      {step === "credentials" && (
        <CredentialsForm
          defaultUsername={searchParams.get("username") ?? ""}
          busy={busy}
          onSubmit={submitCredentials}
          onSignupRequested={() => {
            setError(null);
            setStep("signup");
          }}
        />
      )}

      {step === "signup" && (
        <SignupForm
          defaultUsername={searchParams.get("username") ?? ""}
          defaultToken={tokenParam ?? ""}
          busy={busy}
          onSubmit={submitSignup}
          onBack={() => {
            setError(null);
            setStep("credentials");
          }}
        />
      )}

      {step === "challenge" && (
        <CodeChallengeForm
          busy={busy}
          onSubmit={submitChallenge}
          onModeChange={() => setError(null)}
        />
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
