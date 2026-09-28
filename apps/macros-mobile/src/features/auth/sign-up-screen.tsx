import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  type TextInput,
  View,
} from "react-native";
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
import { signUpWithPassword } from "./actions";
import { AuthScreen, openWebPage } from "./auth-screen";
import { rememberPendingCredentials } from "./memory";
import {
  emailError,
  MIN_PASSWORD_LENGTH,
  nameError,
  PASSWORD_RULES,
  passwordError,
} from "./validation";

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  terms?: string;
}

export function SignUpScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const next: FieldErrors = {
      name: nameError(name),
      email: emailError(email),
      password: passwordError(password),
      terms: accepted ? undefined : "Accept the terms to create an account.",
    };
    setErrors(next);
    setFailure(null);
    if (next.name || next.email || next.password || next.terms) {
      haptics.error();
      return;
    }

    setSubmitting(true);
    const result = await signUpWithPassword({ name, email, password });
    setSubmitting(false);
    if (!result.ok) {
      haptics.error();
      setFailure(result.failure.message);
      return;
    }

    rememberPendingCredentials({ email, password });
    Keyboard.dismiss();
    router.push({ pathname: "/verify-email", params: { email: email.trim() } });
  }

  return (
    <AuthScreen lead="Track what you eat and where your weight is heading. You’ll confirm your email before the first sign-in.">
      <VStack gap={spacing.lg}>
        <TextField
          label="Name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (errors.name) setErrors({ ...errors, name: undefined });
          }}
          error={errors.name}
          placeholder="Your name"
          textContentType="name"
          autoComplete="name"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={!submitting}
        />
        <TextField
          ref={emailRef}
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
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          placeholder="Choose a password"
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          passwordRules={PASSWORD_RULES}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          editable={!submitting}
        />
        <TermsConsent
          accepted={accepted}
          error={errors.terms}
          onToggle={() => {
            haptics.selection();
            setAccepted(!accepted);
            if (errors.terms) setErrors({ ...errors, terms: undefined });
          }}
        />
      </VStack>

      <VStack gap={spacing.sm}>
        {failure ? <InlineNotice message={failure} /> : null}
        <Button
          label="Create account"
          loading={submitting}
          onPress={() => void submit()}
        />
      </VStack>
    </AuthScreen>
  );
}

function TermsConsent({
  accepted,
  error,
  onToggle,
}: {
  accepted: boolean;
  error?: string;
  onToggle: () => void;
}) {
  return (
    <View style={styles.consent}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I agree to the terms and conditions and privacy policy"
        style={styles.consentRow}
      >
        <Icon
          name={accepted ? "circle-check" : "circle"}
          size={22}
          color={
            accepted
              ? colors.label
              : error
                ? colors.destructive
                : colors.tertiaryLabel
          }
        />
        <Text variant="subheadline" tone="secondary" style={styles.consentText}>
          I agree to the{" "}
          <Text
            variant="subheadline"
            weight="semibold"
            accessibilityRole="link"
            onPress={() => openWebPage("/terms")}
          >
            terms and conditions
          </Text>{" "}
          and the{" "}
          <Text
            variant="subheadline"
            weight="semibold"
            accessibilityRole="link"
            onPress={() => openWebPage("/privacy")}
          >
            privacy policy
          </Text>
          .
        </Text>
      </Pressable>
      {error ? (
        <Text variant="footnote" tone="destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  consent: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  consentText: {
    flex: 1,
  },
});
