import { colors, haptics, spacing, Text } from "@repo/native-ui";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { type ReactNode, useRef } from "react";
import { type ColorValue, StyleSheet, View } from "react-native";
import Swipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";

export interface SwipeAction {
  label: string;
  symbol: SymbolViewProps["name"];
  color: ColorValue;
  run: () => void;
}

function Panel({
  action,
  align,
}: {
  action: SwipeAction;
  align: "flex-start" | "flex-end";
}) {
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: action.color, alignItems: align },
      ]}
    >
      <View style={styles.panelContent}>
        <SymbolView name={action.symbol} size={18} tintColor={colors.onTint} />
        <Text variant="footnote" weight="semibold" tone="onTint">
          {action.label}
        </Text>
      </View>
    </View>
  );
}

/**
 * A row decided by a full swipe: right for `onRight` (accept), left for
 * `onLeft` (dismiss). The row closes itself; the list drops it on success.
 */
export function SwipeRow({
  children,
  right,
  left,
}: {
  children: ReactNode;
  right?: SwipeAction;
  left?: SwipeAction;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  return (
    <Swipeable
      ref={swipeable}
      friction={1.6}
      overshootFriction={8}
      leftThreshold={90}
      rightThreshold={90}
      renderLeftActions={
        right ? () => <Panel action={right} align="flex-start" /> : undefined
      }
      renderRightActions={
        left ? () => <Panel action={left} align="flex-end" /> : undefined
      }
      onSwipeableOpen={(direction) => {
        const action = direction === SwipeDirection.RIGHT ? right : left;
        if (!action) return;
        haptics.success();
        action.run();
        swipeable.current?.close();
      }}
    >
      <View style={{ backgroundColor: colors.background }}>{children}</View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, justifyContent: "center", minWidth: 120 },
  panelContent: {
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.xxs,
  },
});
