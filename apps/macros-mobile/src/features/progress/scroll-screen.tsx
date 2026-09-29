import type { ReactNode, Ref } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, gutter, spacing } from "@/ui";

/**
 * `Screen` with a ref: the same insets, keyboard handling and pull to
 * refresh, so a failed save or export can scroll back to its notice at the
 * top instead of leaving it off-screen.
 */
export function ScrollScreen({
  children,
  ref,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  ref?: Ref<ScrollView>;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      ref={ref}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.light();
              onRefresh();
            }}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
});
