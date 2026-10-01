import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  type AccessibilityActionEvent,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from "react-native";
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
const NO_DRAG = Number.MAX_SAFE_INTEGER;

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

const SwipeActionsContext = createContext<readonly SwipeAction[]>([]);

type SwipeAccessibilityProps = Pick<
  PressableProps,
  "accessibilityActions" | "onAccessibilityAction"
>;

/**
 * A swipe cannot be made with VoiceOver or Switch Control, so the row's
 * pressable offers the same actions from the rotor. Spread onto the element
 * that takes focus inside a `SwipeRow`; outside one it adds nothing.
 */
export function useSwipeAccessibility(): SwipeAccessibilityProps {
  const actions = useContext(SwipeActionsContext);
  return useMemo(() => swipeAccessibilityProps(actions), [actions]);
}

/** The same, for a row that renders its own `SwipeRow` around its pressable. */
export function swipeAccessibilityProps(
  actions: readonly SwipeAction[],
): SwipeAccessibilityProps {
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions.map((action) => ({
      name: action.label,
      label: action.label,
    })),
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      actions
        .find((action) => action.label === event.nativeEvent.actionName)
        ?.onPress();
    },
  };
}

/** Mail-style swipe actions for list rows (delete, duplicate, move). */
export function SwipeRow({ children, actions, leadingActions }: SwipeRowProps) {
  const allActions = useMemo(
    () => [...(leadingActions ?? []), ...actions],
    [leadingActions, actions],
  );
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={ACTION_WIDTH / 2}
      leftThreshold={ACTION_WIDTH / 2}
      // Without leading actions a rightward drag is left to whatever wraps
      // the row (the log's retime drag) instead of being swallowed here.
      dragOffsetFromLeftEdge={
        leadingActions && leadingActions.length > 0 ? undefined : NO_DRAG
      }
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
      <View style={{ backgroundColor: colors.background }}>
        <SwipeActionsContext.Provider value={allActions}>
          {children}
        </SwipeActionsContext.Provider>
      </View>
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
