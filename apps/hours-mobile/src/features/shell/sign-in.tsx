import { useAuthState } from "@repo/native-auth/react";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";
import { auth } from "@/lib/auth";
import { Button, colors, Notice, spacing, Text } from "@/ui";

export function SignIn() {
  const state = useAuthState(auth);
  return (
    <View style={styles.screen}>
      <View style={styles.mark}>
        <SymbolView
          name="clock"
          size={56}
          tintColor={colors.label}
          weight="light"
        />
        <Text variant="largeTitle">Hours</Text>
      </View>
      <View style={styles.actions}>
        {state.error ? <Notice message={state.error} /> : null}
        <Button
          label="Sign in"
          loading={state.signingIn}
          onPress={() => void auth.signIn()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    justifyContent: "space-between",
  },
  mark: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  actions: { gap: spacing.md, paddingBottom: spacing.xxxl },
});
