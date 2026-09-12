"use client";

import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import {
  CodeChallengeForm,
  CredentialsForm,
  SignupForm,
} from "@repo/cloud-ui/auth-forms";
import { AuthShell } from "@repo/cloud-ui/auth-shell";
import { BackupCodes, TotpEnrollment } from "@repo/cloud-ui/totp";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient, enrollmentClient } from "@/lib/auth-client";
import {
  authorizeUrl,
  isAuthorizationRedirect,
  isProviderRedirect,
} from "@/lib/authorization";

type Step =
  | "checking"
  | "credentials"
  | "signup"
  | "challenge"
  | "enroll"
  | "backup-codes"
  | "redirecting";

const TITLES: Record<Step, string> = {
  checking: "Sign in",
  credentials: "Sign in",
  signup: "Redeem signup token",
  challenge: "Two-factor",
  enroll: "TOTP enrollment",
  "backup-codes": "Backup codes",
  redirecting: "Signing in",
};

const ALLOW_LOOPBACK = process.env.NODE_ENV !== "production";

function LoginForm() {
  const searchParams = useSearchParams();
  const authorizing = isAuthorizationRedirect(searchParams);
  const reason = searchParams.get("reason");
  const enrollPending = searchParams.get("enroll") === "1";
  const tokenParam = searchParams.get("token");
  const returnTo = safeReturnTo(searchParams.get("returnTo"), {
    allowLoopback: ALLOW_LOOPBACK,
  });

  const [step, setStep] = useState<Step>(
    tokenParam ? "signup" : authorizing || reason ? "credentials" : "checking",
  );
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destination = authorizing
    ? authorizeUrl(searchParams)
    : (returnTo ?? "/");
  const leave = useCallback(() => {
    setStep("redirecting");
    window.location.assign(destination);
  }, [destination]);

  // Every app sends a signed-out browser here, including one that is signed in
  // to the cloud already — landing on a form would make single sign-on a
  // second login. A `reason` means the app just signed this session out, so it
  // is not bounced straight back.
  useEffect(() => {
    if (step !== "checking") return;
    let active = true;
    void api
      .me()
      .then(() => {
        if (active) leave();
      })
      .catch(() => {
        if (active) setStep("credentials");
      });
    return () => {
      active = false;
    };
  }, [step, leave]);

  const finish = async () => {
    try {
      await api.me();
      leave();
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
    // The provider resumed the authorization this sign-in interrupted and the
    // client is already navigating to it.
    if (isProviderRedirect(data)) {
      setStep("redirecting");
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
    const { data, error: verifyError } =
      mode === "recovery"
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      setBusy(false);
      setError(verifyError.message ?? "Invalid code");
      return;
    }
    if (isProviderRedirect(data)) {
      setStep("redirecting");
      return;
    }
    await finish();
    setBusy(false);
  };

  if (step === "checking" || step === "redirecting") {
    return (
      <AuthShell title={TITLES[step]}>
        <span className="block size-1.5 animate-pulse rounded-full bg-muted-foreground" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={TITLES[step]}
      error={
        error ??
        (reason === "forbidden"
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
          onSignupRequested={
            authorizing
              ? undefined
              : () => {
                  setError(null);
                  setStep("signup");
                }
          }
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
          authClient={enrollmentClient}
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
