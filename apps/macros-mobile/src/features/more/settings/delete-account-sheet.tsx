import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { useProfile } from "@/api/profile";
import { deleteAccount } from "@/features/auth/actions";
import { haptics } from "@/lib/haptics";
import { clearSignedInDevice } from "@/lib/session";
import {
  Button,
  gutter,
  InlineNotice,
  spacing,
  Text,
  TextField,
  VStack,
} from "@/ui";

export function DeleteAccountSheet() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    if (password.length === 0) {
      haptics.error();
      setError("Enter your password.");
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setDeleting(true);
    const result = await deleteAccount(password);
    if (!result.ok) {
      setDeleting(false);
      haptics.error();
      setError(result.failure.message);
      return;
    }
    haptics.success();
    // The auth gate swaps to the sign-in stack once the session is gone,
    // which also dismisses this sheet.
    await clearSignedInDevice(queryClient);
  }

  return (
    <View style={styles.sheet}>
      <VStack gap={spacing.sm}>
        <Text variant="headline">Delete account</Text>
        <Text variant="subheadline" tone="secondary">
          This permanently deletes your account
          {profile.data ? ` (${profile.data.email})` : ""} and everything in it:
          your food log, foods, recipes, weigh-ins, progress photos, habits and
          settings. It can’t be undone.
        </Text>
        <Text variant="subheadline" tone="secondary">
          Want a copy? Export it from Progress › Statistics first.
        </Text>
      </VStack>

      <TextField
        label="Password"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (error) setError(null);
        }}
        secureTextEntry
        textContentType="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void confirm()}
        editable={!deleting}
      />

      <VStack gap={spacing.sm}>
        {error ? <InlineNotice tone="error" message={error} /> : null}
        <Button
          label="Delete account"
          variant="destructive"
          loading={deleting}
          onPress={() => void confirm()}
        />
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
});
