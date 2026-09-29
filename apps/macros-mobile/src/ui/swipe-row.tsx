import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { haptics } from "@/lib/haptics";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { colors, spacing } from "./theme";

export interface SwipeAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}

export interface SwipeRowProps {
  children: ReactNode;
  /** Trailing actions, revealed by swiping left. The first sits outermost. */
  actions: SwipeAction[];
  /** Leading actions, revealed by swiping right. */
  leadingActions?: SwipeAction[];
}

const ACTION_WIDTH = 76;

function ActionButtons({
  actions,
  methods,
}: {
  actions: SwipeAction[];
  methods: SwipeableMethods;
}) {
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            methods.close();
            action.onPress();
          }}
          style={[
            styles.action,
            {
              backgroundColor: action.destructive
                ? colors.destructive
                : colors.secondaryLabel,
            },
          ]}
        >
          <Icon name={action.icon} size={18} color={colors.onTint} />
          <Text variant="caption1" weight="semibold" tone="onTint">
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Mail-style swipe actions for list rows (delete, duplicate, move). */
export function SwipeRow({ children, actions, leadingActions }: SwipeRowProps) {
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={ACTION_WIDTH / 2}
      leftThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      overshootLeft={false}
      onSwipeableWillOpen={() => haptics.impact()}
      renderRightActions={(_progress, _translation, methods) => (
        <ActionButtons actions={actions} methods={methods} />
      )}
      renderLeftActions={
        leadingActions && leadingActions.length > 0
          ? (_progress, _translation, methods) => (
              <ActionButtons actions={leadingActions} methods={methods} />
            )
          : undefined
      }
    >
      <View style={{ backgroundColor: colors.background }}>{children}</View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
});
