import { Pressable, StyleSheet, View } from "react-native";
import { colors, Flash, Hairline, Icon, spacing, Text } from "@/ui";
import { useEntryFlashToken } from "./flash";

export function noteFlashKey(date: string) {
  return `note:${date}`;
}

export function DayNoteRow({
  date,
  note,
  onPress,
}: {
  date: string;
  note: string | null;
  onPress: () => void;
}) {
  const flashToken = useEntryFlashToken(noteFlashKey(date));
  return (
    <Flash token={flashToken}>
      <Hairline />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          note ? `Day note: ${note}` : "Add a note for this day"
        }
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Icon name="notebook-pen" size={18} color={colors.secondaryLabel} />
        <View style={styles.text}>
          <Text
            variant="subheadline"
            tone={note ? "primary" : "tertiary"}
            numberOfLines={3}
          >
            {note ?? "Add a note for this day"}
          </Text>
        </View>
        <Icon
          name="chevron-right"
          size={13}
          weight="semibold"
          color={colors.tertiaryLabel}
        />
      </Pressable>
      <Hairline />
    </Flash>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  text: {
    flex: 1,
  },
  pressed: {
    backgroundColor: colors.fill,
  },
});
