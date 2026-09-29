import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";
import { haptics } from "@/lib/haptics";
import { useAndroidKeyboardHeight } from "@/lib/keyboard";
import { colors, gutter, spacing } from "./theme";

export interface ScreenProps extends Omit<ScrollViewProps, "refreshControl"> {
  children: ReactNode;
  /** Pull to refresh. Omit to disable the gesture entirely. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Grouped background for settings-like screens; plain for content. */
  grouped?: boolean;
  /** Drop the horizontal gutter for edge-to-edge lists. */
  bleed?: boolean;
}

/**
 * The scroll container every tab screen uses. `automatic` content insets let
 * the large title collapse and keep the last row clear of the tab bar without
 * any hard-coded padding.
 */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  grouped = false,
  bleed = false,
  contentContainerStyle,
  style,
  ...rest
}: ScreenProps) {
  const keyboard = useAndroidKeyboardHeight(
    rest.automaticallyAdjustKeyboardInsets === true,
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      {...rest}
      style={[
        {
          backgroundColor: grouped
            ? colors.groupedBackground
            : colors.background,
        },
        style,
        keyboard > 0 && { marginBottom: keyboard },
      ]}
      contentContainerStyle={[
        styles.content,
        !bleed && styles.gutter,
        contentContainerStyle,
      ]}
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

/** Vertical rhythm between top-level blocks of a screen. */
export function Stack({
  children,
  gap = spacing.xxl,
}: {
  children: ReactNode;
  gap?: number;
}) {
  return <View style={{ gap }}>{children}</View>;
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  gutter: {
    paddingHorizontal: gutter,
  },
});
