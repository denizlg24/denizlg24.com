import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, Icon, Text } from "@/ui";
import { usePlate } from "../plate-store";

/**
 * The plate in the hub's header. Drawn by us rather than as a native bar
 * button with a badge: the native badge was rebuilt from header options on
 * every hub render and sometimes came back without its count, while the plate
 * still held food. This reads the plate itself, so the count cannot drift.
 */
export function PlateHeaderButton() {
  const plate = usePlate();
  const count = plate.length;
  const empty = count === 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Plate, ${count} ${count === 1 ? "food" : "foods"}`}
      accessibilityState={{ disabled: empty }}
      disabled={empty}
      hitSlop={8}
      onPress={() => router.push("/add-food/plate")}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon
        name="utensils"
        size={20}
        color={empty ? colors.tertiaryLabel : colors.label}
      />
      {empty ? null : (
        <View style={styles.badge} pointerEvents="none">
          <Text
            variant="caption2"
            weight="semibold"
            figure
            style={styles.badgeText}
          >
            {count > 99 ? "99+" : String(count)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.5,
  },
  badge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tint,
  },
  badgeText: {
    color: colors.onTint,
    lineHeight: 15,
  },
});
