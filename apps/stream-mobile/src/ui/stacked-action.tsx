import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import {
  type DimensionValue,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "./text";
import { colors, spacing } from "./theme";

/** An icon over a short label: My List, Trailer, Info beside a title. */
export function StackedAction({
  icon: Icon,
  label,
  onPress,
  active,
  width = 72,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** Amber, e.g. a title already on My List. */
  active?: boolean;
  width?: number;
}) {
  const tint = active ? colors.amber : colors.paper;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      hitSlop={6}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        { width, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon color={tint} size={24} strokeWidth={1.8} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={[styles.label, { color: active ? colors.amber : colors.muted }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A thin amber bar for how far someone got. */
export function ProgressLine({
  value,
  style,
}: {
  value: number;
  style?: ViewStyle;
}) {
  const share = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View style={[styles.track, style]}>
      <View style={[styles.fill, { width: `${share}%` as DimensionValue }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  label: { textAlign: "center" },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(239,233,223,0.22)",
    overflow: "hidden",
  },
  fill: { height: 3, backgroundColor: colors.amber },
});
