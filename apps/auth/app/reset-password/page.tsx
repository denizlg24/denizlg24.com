"use client";

import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { StepButton } from "@repo/auth-ui/flow-step";
import { NewPasswordStep } from "@repo/auth-ui/password-reset-steps";
import { CheckingStep, FlowMessage } from "@repo/auth-ui/status-step";
import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, errorMessage, isApiError } from "@/lib/api";

type Stage = "form" | "done";

function signInHref(returnTo: string | null): string {
  return returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/login";
}

function ResetPassword() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  // Better Auth lands here with `?error=INVALID_TOKEN` for a link that has
  // expired or was already used.
  const invalid = searchParams.get("error") !== null || !token;
  const returnTo = safeReturnTo(searchParams.get("returnTo"), {
    allowLoopback: process.env.NODE_ENV !== "production",
  });
  const [stage, setStage] = useState<Stage>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (newPassword: string) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ newPassword, token });
      setStage("done");
    } catch (err) {
      setError(
        isApiError(err) && err.code === "INVALID_TOKEN"
          ? "This link has expired or was already used. Ask for a new one from the sign-in page."
          : errorMessage(err),
      );
    }
    setBusy(false);
  };

  if (invalid) {
    return (
      <FlowMessage
        title="This link doesn't work any more"
        detail="Reset links work once, for one hour. Ask for a new one from the sign-in page."
        action={
          <StepButton
            type="button"
            onClick={() => window.location.assign(signInHref(returnTo))}
          >
            Go to sign in
          </StepButton>
        }
      />
    );
  }
  if (stage === "done") {
    return (
      <FlowMessage
        title="Your password is changed"
        detail="Sign in with your new password to continue."
        action={
          <StepButton
            type="button"
            onClick={() => window.location.assign(signInHref(returnTo))}
          >
            Sign in
          </StepButton>
        }
      />
    );
  }
  return (
    <NewPasswordStep
      busy={busy}
      error={error}
      onSubmit={(password) => void submit(password)}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <FlowFrame themeToggle={<ThemeToggle />}>
      <Suspense fallback={<CheckingStep />}>
        <ResetPassword />
      </Suspense>
    </FlowFrame>
  );
}
