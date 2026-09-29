import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Keyboard, type TextInput } from "react-native";
import { DEVICE_NAME } from "@/lib/config";
import { haptics } from "@/lib/haptics";
import { Button, InlineNotice, spacing, Text, TextField, VStack } from "@/ui";
import { signInWithPassword } from "./actions";
import { type AuthNotice, AuthScreen } from "./auth-screen";
import {
  lastUsedEmail,
  rememberPendingCredentials,
  resetRequestedEmail,
} from "./memory";
import { emailError, passwordError } from "./validation";

interface FieldErrors {
  email?: string;
  password?: string;
}

/**
 * Also rendered by `verified` (with a notice) and reached from the password
 * reset page's `macros://sign-in` link, so it never assumes how it was opened:
 * the email comes from the route, then from whatever this session last used.
 */
export function SignInScreen({ notice }: { notice?: AuthNotice }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(() => params.email ?? lastUsedEmail());
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(resetRequestedEmail);
  const passwordRef = useRef<TextInput>(null);

  useFocusEffect(
    useCallback(() => {
      const requested = resetRequestedEmail();
      setResetFor(requested);
      if (requested) setEmail((current) => current || requested);
    }, []),
  );

  async function submit() {
    const next: FieldErrors = {
      email: emailError(email),
      password: passwordError(password),
    };
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) {
      haptics.error();
      return;
    }

    setSubmitting(true);
    const result = await signInWithPassword(email, password);
    if (result.ok) {
      // The root gate swaps this stack out as soon as the session lands.
      haptics.success();
      return;
    }
    setSubmitting(false);

    if (result.failure.kind === "unverified") {
      rememberPendingCredentials({ email, password });
      Keyboard.dismiss();
      router.push({
        pathname: "/verify-email",
        params: { email: email.trim() },
      });
      return;
    }
    haptics.error();
    setFailure(result.failure.message);
  }

  const banner: AuthNotice | null = failure
    ? { tone: "error", message: failure }
    : (notice ??
      (resetFor
        ? {
            tone: "info",
            message: "Once you’ve chosen a new password, sign in with it here.",
          }
        : null));

  return (
    <AuthScreen
      lead={`Your food log, recipes and weight trend, on your ${DEVICE_NAME}.`}
    >
      <VStack gap={spacing.lg}>
        <TextField
          label="Email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (errors.email) setErrors({ ...errors, email: undefined });
          }}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!submitting}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors({ ...errors, password: undefined });
          }}
          error={errors.password}
          placeholder="Your password"
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          enablesReturnKeyAutomatically
          onSubmitEditing={() => void submit()}
          editable={!submitting}
        />
        <Button
          label="Forgot password?"
          variant="plain"
          size="small"
          style={{ alignSelf: "flex-start" }}
          onPress={() =>
            router.push({
              pathname: "/forgot-password",
              params: { email: email.trim() },
            })
          }
        />
      </VStack>

      <VStack gap={spacing.sm}>
        {banner ? (
          <InlineNotice tone={banner.tone} message={banner.message} />
        ) : null}
        <Button
          label="Sign in"
          loading={submitting}
          onPress={() => void submit()}
        />
      </VStack>

      <VStack gap={spacing.sm}>
        <Text variant="subheadline" tone="secondary" align="center">
          New to Macros?
        </Text>
        <Button
          label="Create account"
          variant="tinted"
          disabled={submitting}
          onPress={() => router.push("/sign-up")}
        />
      </VStack>
    </AuthScreen>
  );
}
