import { useAuthState } from "@repo/native-auth/react";
import { Button, colors, spacing, Text } from "@repo/native-ui";
import { StyleSheet, View } from "react-native";
import { auth } from "@/lib/auth";

export function SignIn() {
  const state = useAuthState(auth);
  return (
    <View style={styles.screen}>
      <Text variant="largeTitle" style={styles.title}>
        Voice
      </Text>
      {state.error ? (
        <Text variant="footnote" tone="destructive">
          {state.error}
        </Text>
      ) : null}
      <Button
        label="Sign in"
        loading={state.signingIn}
        onPress={() => void auth.signIn()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.xl,
    paddingBottom: 60,
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  title: { position: "absolute", top: "42%", alignSelf: "center" },
});
