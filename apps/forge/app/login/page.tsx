"use client";

import {
  CodeChallengeForm,
  CredentialsForm,
  SignupForm,
} from "@repo/cloud-ui/auth-forms";
import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Step = "credentials" | "signup" | "challenge" | "enroll" | "backup-codes";

const TITLES: Record<Step, string> = {
  credentials: "Sign in",
  signup: "Redeem signup token",
  challenge: "Two-factor",
  enroll: "TOTP enrollment",
  "backup-codes": "Backup codes",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const enrollPending = searchParams.get("enroll") === "1";
  const tokenParam = searchParams.get("token");
  const [step, setStep] = useState<Step>(tokenParam ? "signup" : "credentials");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    try {
      const me = await api.me();
      if (me.role !== "superuser") {
        await authClient.signOut();
        setStep("credentials");
        setError("Superuser required");
        return;
      }
      router.replace("/");
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_ENROLLMENT_REQUIRED") {
        if (!password) {
          setStep("credentials");
          setError("Sign in again to finish TOTP enrollment");
          return;
        }
        setStep("enroll");
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
    setPassword(values.password);
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
    await finish();
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
    setPassword(values.password);
    try {
      await api.completeSignup(values);
      setStep("enroll");
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
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
    await finish();
    setBusy(false);
  };

  return (
    <AuthShell
      title={TITLES[step]}
      error={
        error ??
        (step === "credentials" && reason === "forbidden"
          ? "Signed out — superuser required"
          : step === "credentials" && enrollPending
            ? "TOTP enrollment incomplete"
            : null)
      }
    >
      {step === "credentials" ? (
        <CredentialsForm
          defaultUsername={searchParams.get("username") ?? ""}
          busy={busy}
          onSubmit={submitCredentials}
          onSignupRequested={() => {
            setError(null);
            setStep("signup");
          }}
        />
      ) : null}
      {step === "signup" ? (
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
      ) : null}
      {step === "challenge" ? (
        <CodeChallengeForm
          busy={busy}
          onSubmit={submitChallenge}
          onModeChange={() => setError(null)}
        />
      ) : null}
      {step === "enroll" ? (
        <TotpEnrollment
          authClient={authClient}
          password={password}
          onVerified={(codes) => {
            setPassword("");
            setBackupCodes(codes);
            setStep("backup-codes");
          }}
          onFailed={(message) => {
            setPassword("");
            setStep("credentials");
            setError(message);
          }}
        />
      ) : null}
      {step === "backup-codes" ? (
        <BackupCodes
          codes={backupCodes}
          busy={busy}
          onContinue={() => {
            setBusy(true);
            void finish().finally(() => setBusy(false));
          }}
        />
      ) : null}
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
