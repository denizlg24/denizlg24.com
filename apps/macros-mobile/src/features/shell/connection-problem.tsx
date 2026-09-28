import { StyleSheet, View } from "react-native";
import { Button, colors, EmptyState, spacing } from "@/ui";

/** First launch after sign-in with no cached profile and no network. */
export function ConnectionProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.container}>
      <EmptyState
        icon="wifi-off"
        title="Can’t reach Macros"
        message="Check your connection. Your log will load as soon as you’re back online."
      />
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
});
