import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  Icon,
  InlineNotice,
  spacing,
  Text,
  VStack,
} from "@/ui";
import {
  type AuthFailure,
  resendVerificationEmail,
  signInWithPendingCredentials,
} from "./actions";
import { type AuthNotice, AuthScreen, openMail } from "./auth-screen";
import {
  forgetPendingCredentials,
  lastVerificationSentAt,
  pendingCredentials,
} from "./memory";
import { useCooldown } from "./use-cooldown";

const RESEND_COOLDOWN_SECONDS = 60;

function noticeForFailure(failure: AuthFailure): AuthNotice {
  switch (failure.kind) {
    case "unverified":
      return {
        tone: "info",
        message: "Not verified yet. Tap the link in the email, then try again.",
      };
    case "invalid-credentials":
      return {
        tone: "error",
        message:
          "This email already has an account with another password. Sign in with it, or reset it.",
      };
    default:
      return { tone: "error", message: failure.message };
  }
}

export function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? pendingCredentials()?.email ?? "";
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [sentAt, setSentAt] = useState(() => lastVerificationSentAt(email));
  const cooldown = useCooldown(sentAt, RESEND_COOLDOWN_SECONDS);

  // Coming back from Mail or Safari after tapping the link is the usual way
  // this screen is left, so try quietly each time the app returns.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      void signInWithPendingCredentials()?.then((result) => {
        if (result.ok) haptics.success();
      });
    });
    return () => subscription.remove();
  }, []);

  if (email === "") return <Redirect href="/sign-in" />;

  async function confirmVerified() {
    const attempt = signInWithPendingCredentials();
    if (!attempt) {
      router.dismissTo({ pathname: "/sign-in", params: { email } });
      return;
    }
    setChecking(true);
    setNotice(null);
    const result = await attempt;
    if (result.ok) {
      haptics.success();
      return;
    }
    setChecking(false);
    if (result.failure.kind === "unverified") haptics.warning();
    else haptics.error();
    setNotice(noticeForFailure(result.failure));
  }

  async function resend() {
    setResending(true);
    setNotice(null);
    const result = await resendVerificationEmail(email);
    setResending(false);
    if (!result.ok) {
      haptics.error();
      setNotice({ tone: "error", message: result.failure.message });
      return;
    }
    haptics.success();
    setSentAt(lastVerificationSentAt(email));
    setNotice({ tone: "info", message: "A new link is on its way." });
  }

  async function showInbox() {
    const opened = await openMail();
    if (!opened) {
      setNotice({
        tone: "error",
        message: "Mail isn’t available. Open the email in your mail app.",
      });
    }
  }

  function switchEmail() {
    forgetPendingCredentials();
    if (router.canGoBack()) router.back();
    else router.replace("/sign-up");
  }

  return (
    <AuthScreen>
      <VStack gap={spacing.sm}>
        <Icon
          name="mail-check"
          size={34}
          color={colors.secondaryLabel}
          style={{ marginBottom: spacing.xs }}
        />
        <Text variant="body">We sent a verification link to</Text>
        <Text variant="headline" selectable>
          {email}
        </Text>
        <Text variant="subheadline" tone="secondary">
          Open it on this iPhone and Macros signs you in. Can’t find it? Check
          your spam folder.
        </Text>
      </VStack>

      <VStack gap={spacing.sm}>
        {notice ? (
          <InlineNotice tone={notice.tone} message={notice.message} />
        ) : null}
        <Button
          label="Open Mail"
          icon="mail"
          onPress={() => void showInbox()}
        />
        <Button
          label="I’ve verified"
          variant="tinted"
          loading={checking}
          onPress={() => void confirmVerified()}
        />
      </VStack>

      <VStack gap={spacing.xs}>
        <Button
          label={
            cooldown > 0 ? `Resend email in ${cooldown} s` : "Resend email"
          }
          variant="plain"
          size="small"
          style={{ alignSelf: "flex-start" }}
          loading={resending}
          disabled={cooldown > 0 || checking}
          onPress={() => void resend()}
        />
        <Button
          label="Use a different email"
          variant="plain"
          size="small"
          style={{ alignSelf: "flex-start" }}
          disabled={checking}
          onPress={switchEmail}
        />
      </VStack>
    </AuthScreen>
  );
}
