import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, gutter, spacing } from "./theme";

export interface ScreenProps extends Omit<ScrollViewProps, "refreshControl"> {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  grouped?: boolean;
}

/** The scroll container every screen uses; the large title collapses into it. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  grouped = false,
  contentContainerStyle,
  style,
  ...rest
}: ScreenProps) {
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
      ]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
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
    paddingHorizontal: gutter,
  },
});
