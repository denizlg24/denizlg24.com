"use client";

import { BackupCodesStep } from "@repo/auth-ui/backup-codes-step";
import {
  ACCOUNT_DESTINATION,
  type Destination,
  destinationFromClient,
  destinationFromUrl,
} from "@repo/auth-ui/destination";
import { FlowFrame } from "@repo/auth-ui/flow-frame";
import { StepActions, TextAction } from "@repo/auth-ui/flow-step";
import { transitionStep } from "@repo/auth-ui/flow-transition";
import { InvitationStep } from "@repo/auth-ui/invitation-step";
import { PasskeyOfferStep } from "@repo/auth-ui/passkey-offer-step";
import {
  CheckEmailStep,
  ForgotPasswordStep,
} from "@repo/auth-ui/password-reset-steps";
import { PasswordStep } from "@repo/auth-ui/password-step";
import {
  type SecondFactorMode,
  SecondFactorStep,
} from "@repo/auth-ui/second-factor-step";
import { SignUpStep, type SignUpValues } from "@repo/auth-ui/sign-up-step";
import { CheckingStep, FlowMessage } from "@repo/auth-ui/status-step";
import { TotpEnrollment } from "@repo/auth-ui/totp-enrollment";
import { UsernameStep } from "@repo/auth-ui/username-step";
import { safeReturnTo } from "@repo/cloud-auth-client/redirect";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { PublicTenant } from "@repo/schemas/cloud";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Turnstile } from "@/components/turnstile";
import { api, errorMessage, isApiError } from "@/lib/api";
import { authClient, enrollmentClient } from "@/lib/auth-client";
import {
  authorizeUrl,
  isAuthorizationRedirect,
  isProviderRedirect,
  isRefusedAuthorization,
} from "@/lib/authorization";
import {
  conditionalMediationAvailable,
  defaultPasskeyName,
  isPasskeyDismissed,
  isPasskeyPreviouslyRegistered,
  isPasskeyUnknownToServer,
} from "@/lib/passkey";
import {
  accountHasPasskeyOnDevice,
  forgetPasskeyDevice,
  hasPasskeyOnDevice,
  isPasskeyOfferSnoozed,
  rememberAccountPasskeyDevice,
  rememberPasskeyDevice,
  snoozePasskeyOffer,
} from "@/lib/passkey-device";
import { decidePasskeyOffer } from "@/lib/passkey-offer";

type Step =
  | "checking"
  | "username"
  | "password"
  | "invitation"
  | "challenge"
  | "enroll"
  | "backup-codes"
  | "passkey-offer"
  | "sign-up"
  | "sign-up-sent"
  | "verify-email"
  | "forgot"
  | "reset-sent"
  | "enroll-password"
  | "refused"
  | "redirecting";

/**
 * How the session came to be, which decides whether the passkey offer is
 * worth a screen: a passkey sign-in proves the device has one, and someone
 * who just scanned a QR code and saved backup codes has set up enough today.
 */
type SignInVia = "password" | "passkey" | "enrolled";

// "unknown-credential" is the server reporting that the passkey the
// authenticator offered is not on any account here, which — unlike a plain
// failure — proves this browser's marker is stale.
type PasskeyOutcome =
  | "signed-in"
  | "dismissed"
  | "unknown-credential"
  | "failed";

const ALLOW_LOOPBACK = process.env.NODE_ENV !== "production";

/**
 * The app behind the authorization, when it is someone else's: its name,
 * mark and sign-up policy. `undefined` while asking, `null` for the owner's
 * own clients (which answer 404) or when there is no client at all.
 */
function useTenant(clientId: string | null): PublicTenant | null | undefined {
  const [tenant, setTenant] = useState<PublicTenant | null | undefined>(
    clientId ? undefined : null,
  );
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void api
      .publicTenant(clientId)
      .then((found) => {
        if (active) setTenant(found);
      })
      .catch(() => {
        if (active) setTenant(null);
      });
    return () => {
      active = false;
    };
  }, [clientId]);
  return tenant;
}

/**
 * Whether a session exists, for either kind of account. `/api/me` answers
 * only for the cloud's own (and is what reports a cloud account that still
 * owes its second factor); a public account is a 401 there and is found
 * through `/api/account` instead.
 */
async function currentSession(): Promise<"cloud" | "public"> {
  try {
    await api.me();
    return "cloud";
  } catch (err) {
    if (!isApiError(err) || err.status !== 401) throw err;
    const account = await api.account();
    if (account.realm !== "public") throw err;
    return "public";
  }
}

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
  // The API refused this browser's authorization and says why; the original
  // request rides along, unsigned, to be started again once that is fixed.
  const refused = isRefusedAuthorization(searchParams);
  const inAuthorization = authorizing || refused;
  const reason = searchParams.get("reason");
  const enrollPending = searchParams.get("enroll") === "1";
  const tokenParam = searchParams.get("token");
  const returnTo = safeReturnTo(searchParams.get("returnTo"), {
    allowLoopback: ALLOW_LOOPBACK,
  });
  // A `returnTo` that is itself an authorization (what "use a different
  // account" sends) names the same app as a signed redirect would.
  const clientId = inAuthorization
    ? searchParams.get("client_id")
    : (destinationFromUrl(returnTo)?.clientId ?? null);
  const tenant = useTenant(clientId);

  const [step, setStepState] = useState<Step>(() => {
    if (tokenParam) return "invitation";
    if (refused) {
      switch (reason) {
        case "EMAIL_VERIFICATION_REQUIRED":
          return "verify-email";
        case "MFA_ENROLLMENT_REQUIRED":
          return "enroll-password";
        case "FORBIDDEN":
          return "username";
        default:
          return "refused";
      }
    }
    return authorizing || reason ? "username" : "checking";
  });
  const [username, setUsername] = useState(searchParams.get("username") ?? "");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [trustDevice, setTrustDevice] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Where the last email went, as typed: the server never says whether an
  // address has an account, so this is the only address the page can name.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeRound, setChallengeRound] = useState(0);
  // The signed-in account's own address, for the steps that follow a refusal.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  // Whose offer the "passkey-offer" step is showing. Everything it writes is
  // scoped to this account, so a marker from the previous person on a shared
  // browser neither answers for nor is overwritten by this one.
  const offerUserId = useRef<string | null>(null);

  const destinationInfo = useDestination(
    inAuthorization,
    searchParams,
    returnTo,
  );
  const destinationName =
    destinationInfo && destinationInfo !== "pending"
      ? destinationInfo.name
      : (tenant?.name ?? "this app");

  // A step and the message that goes with it commit together, inside the step
  // transition, so neither paints on the wrong screen.
  const go = useCallback(
    (next: Step, options: { error?: string | null; busy?: boolean } = {}) => {
      transitionStep(() => {
        setStepState(next);
        setError(options.error ?? null);
        setNotice(null);
        if (options.busy !== undefined) setBusy(options.busy);
      });
    },
    [],
  );

  const destination = inAuthorization
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
    void currentSession()
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

  // Only a plain `returnTo` sign-in pauses for the offer. An authorization
  // redirect is resumed by the provider itself the moment the session
  // exists, so there is no gap to put a screen in.
  const maybeOfferPasskey = async (): Promise<boolean> => {
    if (inAuthorization) return false;
    const [session, passkeys] = await Promise.all([
      authClient.getSession(),
      authClient.passkey.listUserPasskeys(),
    ]);
    if (!session.data || passkeys.error) return false;
    const userId = session.data.user.id;
    const decision = decidePasskeyOffer({
      passkeys: passkeys.data ?? [],
      userAgent: navigator.userAgent,
      deviceHasPasskey: accountHasPasskeyOnDevice(userId),
      dismissed: session.data.user.passkeyOfferDismissed === true,
      snoozed: isPasskeyOfferSnoozed(userId),
    });
    if (decision !== "offer") return false;
    offerUserId.current = userId;
    return true;
  };

  // `knownPassword` is the one the caller just submitted, passed explicitly:
  // read from state it would be the value of the render this handler was
  // created in, which on a first sign-in is still empty.
  const finish = async (knownPassword: string, via: SignInVia) => {
    try {
      await currentSession();
      if (
        via === "password" &&
        (await maybeOfferPasskey().catch(() => false))
      ) {
        go("passkey-offer", { busy: false });
        return;
      }
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
    // Someone else's app knows its people by email; the cloud's own accounts
    // have usernames. Either field value works on either screen.
    const byEmail = username.includes("@");
    const { data, error: signInError } = byEmail
      ? await authClient.signIn.email({
          email: username,
          password: value,
          rememberMe,
        })
      : await authClient.signIn.username({
          username,
          password: value,
          rememberMe,
        });
    if (signInError) {
      setBusy(false);
      setError(
        signInError.message ??
          `That didn't work. Check the ${byEmail ? "email" : "username"} and password and try again.`,
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
    await finish(value, "password");
    setBusy(false);
  };

  // A passkey answers both factors, so there is no challenge step: the
  // provider resumes an interrupted authorization exactly as it does after a
  // password sign-in, and anything else lands in `finish`. `mode` is who
  // started the ceremony: only the button sets busy, since the two
  // browser-driven modes (autofill, the automatic prompt) leave the form
  // usable underneath. A refusal is reported whoever started it — the visitor
  // picked a passkey either way — while a dismissal never is.
  const signInWithPasskey = async (
    mode: "button" | "autofill" | "automatic",
  ): Promise<PasskeyOutcome> => {
    const autoFill = mode === "autofill";
    if (mode === "button") {
      setBusy(true);
      setError(null);
    }
    const { data, error: passkeyError } = await authClient.signIn.passkey({
      autoFill,
    });
    if (passkeyError) {
      const dismissed = isPasskeyDismissed(passkeyError);
      if (!dismissed) {
        setError(
          passkeyError.message ??
            "The passkey didn't work. Try again, or use your password.",
        );
      }
      // The aborted autofill request reports here while the modal ceremony
      // it yielded to is still up; only the path that set busy clears it.
      if (mode === "button") setBusy(false);
      if (dismissed) return "dismissed";
      return isPasskeyUnknownToServer(passkeyError)
        ? "unknown-credential"
        : "failed";
    }
    rememberPasskeyDevice();
    if (isProviderRedirect(data)) {
      go("redirecting");
      return "signed-in";
    }
    setBusy(true);
    await finish(password, "passkey");
    setBusy(false);
    return "signed-in";
  };

  // The username step starts one browser-driven ceremony per visit. When
  // this browser has used a passkey before, that is the modal prompt itself,
  // so a returning device signs in without touching the form; a dismissal
  // drops the marker (a shared device, or the passkey is gone) and the visit
  // falls back to conditional mediation — the pending request the browser
  // resolves when a passkey is picked from the field's autofill. Starting the
  // button's modal ceremony aborts whichever is pending, which the
  // dismissed-error check swallows. The ref keeps the effect keyed on the
  // step alone, so a failed password attempt does not start a second request;
  // the automatic prompt additionally runs once per page load, and not at all
  // when an app just signed this session out (`reason`): signing the same
  // account straight back in is the loop that message exists to break.
  const passkeyCeremony = useRef(signInWithPasskey);
  useEffect(() => {
    passkeyCeremony.current = signInWithPasskey;
  });
  const automaticTried = useRef(false);
  useEffect(() => {
    if (step !== "username") return;
    let active = true;
    const start = async () => {
      if (!automaticTried.current && !reason && hasPasskeyOnDevice()) {
        automaticTried.current = true;
        const outcome = await passkeyCeremony.current("automatic");
        if (!active || outcome === "signed-in") return;
        if (outcome === "dismissed" || outcome === "unknown-credential") {
          forgetPasskeyDevice();
        }
      }
      const available = await conditionalMediationAvailable();
      if (active && available) void passkeyCeremony.current("autofill");
    };
    void start();
    return () => {
      active = false;
    };
  }, [step, reason]);

  const rememberOfferedPasskey = () => {
    const userId = offerUserId.current;
    if (userId) rememberAccountPasskeyDevice(userId);
    else rememberPasskeyDevice();
  };

  const addOfferedPasskey = async () => {
    setBusy(true);
    setError(null);
    const { error: passkeyError } = await authClient.passkey.addPasskey({
      name: defaultPasskeyName(navigator.userAgent),
    });
    if (passkeyError) {
      // The authenticator refusing a duplicate is the one exact answer to
      // "does this device have one": it does, so the offer was redundant.
      if (isPasskeyPreviouslyRegistered(passkeyError)) {
        rememberOfferedPasskey();
        leave();
        return;
      }
      setBusy(false);
      setError(
        isPasskeyDismissed(passkeyError)
          ? "The browser closed the prompt before the passkey was made. Try again, or continue without one."
          : (passkeyError.message ?? "Couldn't create the passkey."),
      );
      return;
    }
    rememberOfferedPasskey();
    leave();
  };

  const declineOfferedPasskey = async (forever: boolean) => {
    setBusy(true);
    // The snooze stands whatever happens next, so a write that fails does not
    // turn into a second offer today.
    const userId = offerUserId.current;
    if (userId) snoozePasskeyOffer(userId);
    if (forever) {
      // "Never" that silently lasted 30 days would be a lie, so a refused or
      // failed write keeps the visitor here with the reason rather than
      // redirecting as though it had been recorded.
      const dismissal = await authClient
        .updateUser({ passkeyOfferDismissed: true })
        .catch((err: unknown) => ({ error: { message: errorMessage(err) } }));
      if (dismissal.error) {
        setBusy(false);
        setError(
          dismissal.error.message ??
            "Couldn't save that. Continue without a passkey and we'll ask again another time.",
        );
        return;
      }
    }
    leave();
  };

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
    await finish(password, "password");
    setBusy(false);
  };

  // The steps after a refusal speak to the account that was refused.
  useEffect(() => {
    if (step !== "verify-email" && step !== "enroll-password") return;
    let active = true;
    void api
      .account()
      .then((account) => {
        if (!active) return;
        setAccountEmail(account.email);
        setUsername(account.username ?? account.email);
      })
      .catch(() => {
        if (active) go("username");
      });
    return () => {
      active = false;
    };
  }, [step, go]);

  const nextChallenge = () => setChallengeRound((round) => round + 1);

  const challengeMessage = (err: unknown): string => {
    if (!isApiError(err)) return errorMessage(err);
    switch (err.code) {
      case "CHALLENGE_FAILED":
        return "We couldn't check that you're not a bot. Try again.";
      case "SIGNUP_CLOSED":
        return `${destinationName} isn't taking new accounts right now.`;
      case "SIGNUP_INVITE_ONLY":
        return `${destinationName} only lets in people it has invited.`;
      case "RATE_LIMITED":
      case "TOO_MANY_REQUESTS":
        return "That's a lot of attempts. Wait a few minutes and try again.";
      default:
        return err.message;
    }
  };

  const submitSignUp = async (values: SignUpValues) => {
    if (!clientId || !challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      await api.signUp(
        { ...values, clientId, callbackURL: destination },
        challengeToken,
      );
      setSentTo(values.email);
      go("sign-up-sent", { busy: false });
    } catch (err) {
      setBusy(false);
      setError(challengeMessage(err));
    }
    nextChallenge();
  };

  const resendVerification = async (email: string) => {
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      await api.resendVerification(
        { email, callbackURL: destination },
        challengeToken,
      );
      setNotice("Sent. The newest link is the one that works.");
    } catch (err) {
      setError(challengeMessage(err));
    }
    setBusy(false);
    nextChallenge();
  };

  const requestReset = async (email: string) => {
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    const landing = new URL("/reset-password", window.location.origin);
    landing.searchParams.set("returnTo", destination);
    try {
      await api.requestPasswordReset(
        { email, redirectTo: landing.toString() },
        challengeToken,
      );
      setSentTo(email);
      if (step === "forgot") go("reset-sent", { busy: false });
      else {
        setNotice("Sent. The newest link is the one that works.");
        setBusy(false);
      }
    } catch (err) {
      setBusy(false);
      setError(challengeMessage(err));
    }
    nextChallenge();
  };

  const challenge = (
    <Turnstile onToken={setChallengeToken} resetKey={challengeRound} />
  );
  const legal =
    tenant && (tenant.termsUrl || tenant.privacyUrl) ? (
      <>
        By creating an account you agree to {tenant.name}'s{" "}
        {tenant.termsUrl ? (
          <a
            href={tenant.termsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            terms
          </a>
        ) : null}
        {tenant.termsUrl && tenant.privacyUrl ? " and " : null}
        {tenant.privacyUrl ? (
          <a
            href={tenant.privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            privacy policy
          </a>
        ) : null}
        .
      </>
    ) : null;
  // Signs this account out and starts the same request again, the way the
  // consent page's "Not you?" does, so a different account can try it.
  const switchAccount = () => {
    window.location.assign(
      `/logout?returnTo=${encodeURIComponent(destination)}`,
    );
  };

  const pageNotice =
    reason === "forbidden" || reason === "FORBIDDEN"
      ? `This account can't open ${destinationName}. Sign in with a different account.`
      : enrollPending
        ? "Your authenticator app isn't set up yet. Sign in again to finish."
        : null;

  return (
    <FlowFrame
      destination={destinationInfo}
      app={tenant ? { name: tenant.name, logoUrl: tenant.logoUrl } : null}
      themeToggle={<ThemeToggle />}
    >
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
          notice={pageNotice}
          acceptEmail={Boolean(tenant)}
          onSignUp={
            clientId && tenant?.signup === "open"
              ? () => go("sign-up")
              : undefined
          }
          onContinue={(value) => {
            setUsername(value);
            go("password");
          }}
          onPasskey={() => void signInWithPasskey("button")}
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
          onPasskey={() => void signInWithPasskey("button")}
          onBack={() => go("username")}
          onForgotPassword={tenant ? () => go("forgot") : undefined}
        />
      ) : null}
      {step === "sign-up" ? (
        <SignUpStep
          appName={destinationName}
          defaultEmail={username.includes("@") ? username : ""}
          busy={busy}
          error={error}
          challenge={challenge}
          challengeReady={challengeToken !== null}
          legal={legal}
          onSubmit={(values) => void submitSignUp(values)}
          onSignIn={() => go("username")}
        />
      ) : null}
      {step === "sign-up-sent" ? (
        <CheckEmailStep
          title="Check your email"
          email={sentTo}
          detail={`Open the link in it on this device to confirm your address and continue to ${destinationName}. It works for one hour.`}
          busy={busy}
          error={error}
          notice={notice}
          challenge={challenge}
          resendReady={challengeToken !== null}
          onResend={sentTo ? () => void resendVerification(sentTo) : undefined}
          onBack={() => go("username")}
        />
      ) : null}
      {step === "verify-email" ? (
        <CheckEmailStep
          title="Confirm your email address"
          email={accountEmail}
          detail={`${destinationName} needs a confirmed email address. Open the link we sent you on this device, or send a new one.`}
          busy={busy}
          error={error}
          notice={notice}
          challenge={challenge}
          resendReady={challengeToken !== null && accountEmail !== null}
          onResend={
            accountEmail
              ? () => void resendVerification(accountEmail)
              : undefined
          }
          onContinue={leave}
          continueLabel="I've confirmed it"
          onBack={switchAccount}
          backLabel="Use a different account"
        />
      ) : null}
      {step === "forgot" ? (
        <ForgotPasswordStep
          defaultEmail={username.includes("@") ? username : ""}
          busy={busy}
          error={error}
          challenge={challenge}
          challengeReady={challengeToken !== null}
          onSubmit={(email) => void requestReset(email)}
          onBack={() => go("username")}
        />
      ) : null}
      {step === "reset-sent" ? (
        <CheckEmailStep
          title="Check your email"
          email={sentTo}
          detail="If there's an account for that address, the email has a link to choose a new password. It works for one hour."
          busy={busy}
          error={error}
          notice={notice}
          challenge={challenge}
          resendReady={challengeToken !== null}
          onResend={sentTo ? () => void requestReset(sentTo) : undefined}
          onBack={() => go("username")}
        />
      ) : null}
      {step === "enroll-password" ? (
        <PasswordStep
          username={username}
          heading="Set up two-step sign-in"
          notice={`${destinationName} asks for a code from an authenticator app as well as your password. Enter your password to set one up — it takes a minute.`}
          busy={busy}
          error={error}
          rememberMe={{ checked: rememberMe, onChange: setRememberMe }}
          onContinue={(value) => {
            setPassword(value);
            go("enroll");
          }}
          onBack={switchAccount}
        />
      ) : null}
      {step === "refused" ? (
        <FlowMessage
          title={
            reason === "TENANT_ACCESS_BLOCKED"
              ? `You can't use ${destinationName} with this account`
              : reason === "TENANT_UNAVAILABLE"
                ? `${destinationName} isn't available right now`
                : "This sign-in couldn't continue"
          }
          detail={
            reason === "TENANT_ACCESS_BLOCKED"
              ? `If you think that's a mistake, contact ${destinationName}.`
              : reason === "TENANT_UNAVAILABLE"
                ? "Try again later."
                : "Your account isn't active. If you think that's a mistake, contact whoever runs this app."
          }
          action={
            <StepActions>
              <TextAction onClick={switchAccount}>
                Use a different account
              </TextAction>
            </StepActions>
          }
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
            go(refused ? "enroll-password" : "username", { error: message });
          }}
        />
      ) : null}
      {step === "backup-codes" ? (
        <BackupCodesStep
          codes={backupCodes}
          busy={busy}
          onContinue={() => {
            setBusy(true);
            void finish(password, "enrolled").finally(() => setBusy(false));
          }}
        />
      ) : null}
      {step === "passkey-offer" ? (
        <PasskeyOfferStep
          busy={busy}
          error={error}
          destinationName={destinationName}
          onAdd={() => void addOfferedPasskey()}
          onLater={() => void declineOfferedPasskey(false)}
          onNever={() => void declineOfferedPasskey(true)}
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
