import { StyleSheet, View } from "react-native";
import { session, useSession } from "@/lib/auth";
import { Button, spacing, Text } from "@/ui";
import { GateScreen } from "./gate-screen";

export function SignIn() {
  const state = useSession();
  return (
    <GateScreen
      title="Welcome to Stream"
      message="Films and series for the whole family, with a list of your own and recommendations picked for you. Sign in with the account Deniz set up for you to get started."
    >
      {state.error ? (
        <View style={styles.notice}>
          <Text variant="subheadline" color="danger">
            {state.error}
          </Text>
        </View>
      ) : null}
      <Button
        label="Sign in"
        size="large"
        block
        loading={state.signingIn}
        onPress={() => void session.signIn()}
      />
      <Text variant="footnote" color="faint" style={styles.hint}>
        A browser window opens to sign you in, then brings you straight back
        here.
      </Text>
    </GateScreen>
  );
}

const styles = StyleSheet.create({
  notice: { paddingVertical: spacing.xs },
  hint: { textAlign: "center" },
});
