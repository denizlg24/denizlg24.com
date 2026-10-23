import { PROFILE_COLORS, type ProfileColor } from "@repo/schemas/stream";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { profileColorNames, profileColors, spacing } from "@/ui";

export function ColorPicker({
  value,
  onChange,
}: {
  value: ProfileColor;
  onChange: (color: ProfileColor) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {PROFILE_COLORS.map((color) => {
        const selected = color === value;
        return (
          <Pressable
            key={color}
            accessibilityRole="radio"
            accessibilityLabel={profileColorNames[color]}
            accessibilityState={{ selected }}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(color);
            }}
            style={({ pressed }) => [
              styles.swatch,
              {
                backgroundColor: profileColors[color],
                opacity: pressed ? 0.75 : 1,
              },
              selected ? styles.selected : null,
            ]}
          >
            {selected ? (
              <Check color="#ffffff" size={20} strokeWidth={3} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: { transform: [{ scale: 1.12 }] },
});
