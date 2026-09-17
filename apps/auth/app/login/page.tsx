"use client";

import { BackupCodesStep } from "@repo/auth-ui/backup-codes-step";
import {
  ACCOUNT_DESTINATION,
  type Destination,
  destinationFromClient,
  destinationFromUrl,
} from "@repo/auth-ui/destination";
import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { transitionStep } from "@repo/auth-ui/flow-transition";
import { InvitationStep } from "@repo/auth-ui/invitation-step";
import { PasswordStep } from "@repo/auth-ui/password-step";
import {
  type SecondFactorMode,
  SecondFactorStep,
} from "@repo/auth-ui/second-factor-step";
import { CheckingStep, FlowMessage } from "@repo/auth-ui/status-step";
import { TotpEnrollment } from "@repo/auth-ui/totp-enrollment";
import { UsernameStep } from "@repo/auth-ui/username-step";
import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient, enrollmentClient } from "@/lib/auth-client";
import {
  authorizeUrl,
  isAuthorizationRedirect,
  isProviderRedirect,
} from "@/lib/authorization";
import {
  conditionalMediationAvailable,
  isPasskeyDismissed,
} from "@/lib/passkey";

type Step =
  | "checking"
  | "username"
  | "password"
  | "invitation"
  | "challenge"
  | "enroll"
  | "backup-codes"
  | "redirecting";

const ALLOW_LOOPBACK = process.env.NODE_ENV !== "production";

/** Resolves an OAuth client's public name for the destination line. */
function useDestination(
  authorizing: boolean,
  searchParams: URLSearchParams,
  returnTo: string | null,
): Destination | "pending" | null {
  const base = useMemo<Destination | null>(() => {
    if (authorizing) {
      const clientId = searchParams.get("client_id") ?? "";
      return { name: clientId, host: null, clientId };
    }
    return returnTo ? destinationFromUrl(returnTo) : ACCOUNT_DESTINATION;
  }, [authorizing, searchParams, returnTo]);
  const clientId = base?.clientId;
  const [resolved, setResolved] = useState<Destination | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void api
      .publicClient(clientId)
      .then((client) => {
        if (active) setResolved(destinationFromClient(clientId, client));
      })
      .catch(() => {
        if (active) setResolved(destinationFromClient(clientId, null));
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  if (!clientId) return base;
  return resolved ?? "pending";
}

function LoginFlow() {
  const searchParams = useSearchParams();
  const authorizing = isAuthorizationRedirect(searchParams);
  const reason = searchParams.get("reason");
  const enrollPending = searchParams.get("enroll") === "1";
  const tokenParam = searchParams.get("token");
  const returnTo = safeReturnTo(searchParams.get("returnTo"), {
    allowLoopback: ALLOW_LOOPBACK,
  });

  const [step, setStepState] = useState<Step>(
    tokenParam ? "invitation" : authorizing || reason ? "username" : "checking",
  );
  const [username, setUsername] = useState(searchParams.get("username") ?? "");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [trustDevice, setTrustDevice] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destinationInfo = useDestination(authorizing, searchParams, returnTo);
  const destinationName =
    destinationInfo && destinationInfo !== "pending"
      ? destinationInfo.name
      : "this app";

  // A step and the message that goes with it commit together, inside the step
  // transition, so neither paints on the wrong screen.
  const go = useCallback(
    (next: Step, options: { error?: string | null; busy?: boolean } = {}) => {
      transitionStep(() => {
        setStepState(next);
        setError(options.error ?? null);
        if (options.busy !== undefined) setBusy(options.busy);
      });
    },
    [],
  );

  const destination = authorizing
    ? authorizeUrl(searchParams)
    : (returnTo ?? "/");
  const leave = useCallback(() => {
    go("redirecting");
    window.location.assign(destination);
  }, [destination, go]);

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
        if (active) go("username");
      });
    return () => {
      active = false;
    };
  }, [step, leave, go]);

  // `knownPassword` is the one the caller just submitted, passed explicitly:
  // read from state it would be the value of the render this handler was
  // created in, which on a first sign-in is still empty.
  const finish = async (knownPassword: string) => {
    try {
      await api.me();
      leave();
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_ENROLLMENT_REQUIRED") {
        if (!knownPassword) {
          go("username", {
            error: "Sign in again to finish setting up your authenticator app.",
          });
          return;
        }
        go("enroll");
        return;
      }
      setError(errorMessage(err));
    }
  };

  const submitCredentials = async (value: string) => {
    setBusy(true);
    setError(null);
    setPassword(value);
    const { data, error: signInError } = await authClient.signIn.username({
      username,
      password: value,
      rememberMe,
    });
    if (signInError) {
      setBusy(false);
      setError(
        signInError.message ??
          "That didn't work. Check the username and password and try again.",
      );
      return;
    }
    // The provider resumed the authorization this sign-in interrupted and the
    // client is already navigating to it.
    if (isProviderRedirect(data)) {
      go("redirecting");
      return;
    }
    if (data && "twoFactorRedirect" in data) {
      go("challenge", { busy: false });
      return;
    }
    await finish(value);
    setBusy(false);
  };

  // A passkey answers both factors, so there is no challenge step: the
  // provider resumes an interrupted authorization exactly as it does after a
  // password sign-in, and anything else lands in `finish`.
  const signInWithPasskey = async (autoFill: boolean) => {
    if (!autoFill) {
      setBusy(true);
      setError(null);
    }
    const { data, error: passkeyError } = await authClient.signIn.passkey({
      autoFill,
    });
    if (passkeyError) {
      if (!isPasskeyDismissed(passkeyError)) {
        setError(
          passkeyError.message ??
            "The passkey didn't work. Try again, or use your password.",
        );
      }
      // The aborted autofill request reports here while the modal ceremony
      // it yielded to is still up; only the path that set busy clears it.
      if (!autoFill) setBusy(false);
      return;
    }
    if (isProviderRedirect(data)) {
      go("redirecting");
      return;
    }
    setBusy(true);
    await finish(password);
    setBusy(false);
  };

  // Conditional mediation: one pending request per visit to the username
  // step, which the browser resolves when a passkey is picked from the
  // field's autofill. Starting the button's modal ceremony aborts it, which
  // the dismissed-error check swallows. The ref keeps the effect keyed on the
  // step alone, so a failed password attempt does not start a second request.
  const autofill = useRef(() => {});
  useEffect(() => {
    autofill.current = () => void signInWithPasskey(true);
  });
  useEffect(() => {
    if (step !== "username") return;
    let active = true;
    void conditionalMediationAvailable().then((available) => {
      if (active && available) autofill.current();
    });
    return () => {
      active = false;
    };
  }, [step]);

  const submitInvitation = async (values: {
    username: string;
    email: string;
    password: string;
    token: string;
  }) => {
    setBusy(true);
    setError(null);
    setPassword(values.password);
    setUsername(values.username);
    try {
      await api.completeSignup(values);
      go("enroll");
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  const submitChallenge = async (code: string, mode: SecondFactorMode) => {
    setBusy(true);
    setError(null);
    const { data, error: verifyError } =
      mode === "backup"
        ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (verifyError) {
      setBusy(false);
      setError(
        verifyError.message ??
          (mode === "backup"
            ? "That backup code didn't match. Each one works once."
            : "That code didn't match. Wait for the next one and try again."),
      );
      return;
    }
    if (isProviderRedirect(data)) {
      go("redirecting");
      return;
    }
    await finish(password);
    setBusy(false);
  };

  const notice =
    reason === "forbidden"
      ? `This account can't open ${destinationName}. Sign in with a different account.`
      : enrollPending
        ? "Your authenticator app isn't set up yet. Sign in again to finish."
        : null;

  return (
    <FlowFrame destination={destinationInfo} themeToggle={<ThemeToggle />}>
      {step === "checking" ? <CheckingStep /> : null}
      {step === "redirecting" ? (
        <FlowMessage
          title="Signing you in"
          detail={`Taking you to ${destinationName}.`}
        />
      ) : null}
      {step === "username" ? (
        <UsernameStep
          defaultUsername={username}
          busy={busy}
          error={error}
          notice={notice}
          onContinue={(value) => {
            setUsername(value);
            go("password");
          }}
          onPasskey={() => void signInWithPasskey(false)}
          onInvitation={authorizing ? undefined : () => go("invitation")}
        />
      ) : null}
      {step === "password" ? (
        <PasswordStep
          username={username}
          defaultPassword={password}
          busy={busy}
          error={error}
          rememberMe={{ checked: rememberMe, onChange: setRememberMe }}
          onContinue={(value) => void submitCredentials(value)}
          onPasskey={() => void signInWithPasskey(false)}
          onBack={() => go("username")}
        />
      ) : null}
      {step === "invitation" ? (
        <InvitationStep
          defaultUsername={username}
          defaultToken={tokenParam ?? ""}
          busy={busy}
          error={error}
          onSubmit={(values) => void submitInvitation(values)}
          onBack={() => go("username")}
        />
      ) : null}
      {step === "challenge" ? (
        <SecondFactorStep
          busy={busy}
          error={error}
          trustDevice={{ checked: trustDevice, onChange: setTrustDevice }}
          onSubmit={(code, mode) => void submitChallenge(code, mode)}
          onModeChange={() => setError(null)}
          onBack={() => go("password")}
        />
      ) : null}
      {step === "enroll" ? (
        <TotpEnrollment
          authClient={enrollmentClient}
          password={password}
          onVerified={(codes) => {
            setPassword("");
            setBackupCodes(codes);
            go("backup-codes");
          }}
          onFailed={(message) => {
            setPassword("");
            go("username", { error: message });
          }}
        />
      ) : null}
      {step === "backup-codes" ? (
        <BackupCodesStep
          codes={backupCodes}
          busy={busy}
          onContinue={() => {
            setBusy(true);
            void finish(password).finally(() => setBusy(false));
          }}
        />
      ) : null}
    </FlowFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <FlowFrame themeToggle={<ThemeToggle />}>
          <CheckingStep />
        </FlowFrame>
      }
    >
      <LoginFlow />
    </Suspense>
  );
}
