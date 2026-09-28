import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useCalorieSummary } from "@/api/dashboard";
import { Icon, spacing, Text } from "@/ui";
import { plateTotals, usePlate } from "../plate-store";
import { useZone } from "../target";
import { CaloriePill } from "./calorie-pill";

function openPlate() {
  // One action: the camera closes and the plate opens over the hub.
  router.back();
  router.push("/add-food/plate");
}

/** The hub's calorie pill and plate, carried onto the barcode camera. */
export function CameraStatus() {
  const zone = useZone();
  const plate = usePlate();
  const summary = useCalorieSummary(zone.today).data;
  const count = plate.length;

  return (
    <View style={styles.row}>
      <CaloriePill
        consumed={summary?.consumed ?? 0}
        staged={plateTotals(plate).calories}
        target={summary?.target ?? null}
        energyUnit={zone.energyUnit}
        onCamera
      />
      {count > 0 ? (
        <Pressable
          onPress={openPlate}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Plate, ${count} ${count === 1 ? "food" : "foods"}`}
          style={({ pressed }) => [styles.plate, pressed && styles.pressed]}
        >
          <Icon name="utensils" size={18} weight="semibold" color="#ffffff" />
          <View style={styles.badge}>
            <Text variant="caption2" weight="bold" style={styles.badgeText}>
              {String(count)}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  plate: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ff3b30",
  },
  badgeText: {
    color: "#ffffff",
  },
  pressed: {
    opacity: 0.6,
  },
});
