import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  Icon,
  InlineNotice,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";
import { requestPasswordReset } from "./actions";
import { type AuthNotice, AuthScreen, openMail } from "./auth-screen";
import { lastResetSentAt, lastUsedEmail } from "./memory";
import { useCooldown } from "./use-cooldown";
import { emailError } from "./validation";

const RESEND_COOLDOWN_SECONDS = 60;

export function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(() => params.email || lastUsedEmail());
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const cooldown = useCooldown(sentAt, RESEND_COOLDOWN_SECONDS);

  async function send() {
    const invalid = emailError(email);
    setError(invalid);
    setNotice(null);
    if (invalid) {
      haptics.error();
      return;
    }
    setSending(true);
    const result = await requestPasswordReset(email);
    setSending(false);
    if (!result.ok) {
      haptics.error();
      setNotice({ tone: "error", message: result.failure.message });
      return;
    }
    const trimmed = email.trim();
    haptics.success();
    Keyboard.dismiss();
    if (sentTo) setNotice({ tone: "info", message: "Sent another link." });
    setSentTo(trimmed);
    setSentAt(lastResetSentAt(trimmed));
  }

  function backToSignIn() {
    router.dismissTo({
      pathname: "/sign-in",
      params: sentTo ? { email: sentTo } : {},
    });
  }

  if (sentTo) {
    return (
      <AuthScreen>
        <VStack gap={spacing.sm}>
          <Icon
            name="mail-check"
            size={34}
            color={colors.secondaryLabel}
            style={{ marginBottom: spacing.xs }}
          />
          <Text variant="body">If there’s an account for</Text>
          <Text variant="headline" selectable>
            {sentTo}
          </Text>
          <Text variant="subheadline" tone="secondary">
            a link to choose a new password is on its way. Set it on the page
            the link opens, then come back here to sign in.
          </Text>
        </VStack>

        <VStack gap={spacing.sm}>
          {notice ? (
            <InlineNotice tone={notice.tone} message={notice.message} />
          ) : null}
          <Button
            label="Open Mail"
            icon="mail"
            onPress={() =>
              void openMail().then((opened) => {
                if (!opened) {
                  setNotice({
                    tone: "error",
                    message:
                      "Mail isn’t available. Open the email in your mail app.",
                  });
                }
              })
            }
          />
          <Button
            label="Back to sign in"
            variant="tinted"
            onPress={backToSignIn}
          />
        </VStack>

        <Button
          label={cooldown > 0 ? `Send again in ${cooldown} s` : "Send again"}
          variant="plain"
          size="small"
          style={{ alignSelf: "flex-start" }}
          loading={sending}
          disabled={cooldown > 0}
          onPress={() => void send()}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen lead="Enter the email you signed up with and we’ll send a link to choose a new password.">
      <TextField
        label="Email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (error) setError(undefined);
        }}
        error={error}
        placeholder="you@example.com"
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={email === ""}
        returnKeyType="send"
        enablesReturnKeyAutomatically
        onSubmitEditing={() => void send()}
        editable={!sending}
      />
      <VStack gap={spacing.sm}>
        {notice ? (
          <InlineNotice tone={notice.tone} message={notice.message} />
        ) : null}
        <Button
          label="Send reset link"
          loading={sending}
          onPress={() => void send()}
        />
      </VStack>
    </AuthScreen>
  );
}
