import { format, parseISO } from "date-fns";
import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, Hairline, Icon, Row, spacing, Text } from "@/ui";
import { CompactDatePicker } from "@/ui/date-time-picker";

const ISO_DATE = "yyyy-MM-dd";

/**
 * An optional date. Unset, the row reads "Not set" and tapping it fills in
 * `defaultDate`; set, it carries the compact date pill, whose calendar closes
 * itself once a day is picked.
 */
export function DateRow({
  title,
  value,
  onChange,
  defaultDate,
  minimumDate,
  maximumDate,
  detail,
  error,
}: {
  title: string;
  /** `yyyy-MM-dd` or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  defaultDate: Date;
  minimumDate: Date;
  maximumDate: Date;
  detail?: string;
  error?: string;
}) {
  function fill() {
    haptics.selection();
    onChange(format(defaultDate, ISO_DATE));
  }

  function clear() {
    haptics.selection();
    onChange(null);
  }

  return (
    <View>
      {value ? (
        <Row
          title={title}
          subtitle={detail}
          separator={!error}
          trailing={
            <View style={styles.trailing}>
              <CompactDatePicker
                value={parseISO(value)}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onValueChange={(date) => {
                  haptics.selection();
                  onChange(format(date, ISO_DATE));
                }}
              />
              <Pressable
                onPress={clear}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${title.toLowerCase()}`}
              >
                <Icon name="circle-x" size={18} color={colors.tertiaryLabel} />
              </Pressable>
            </View>
          }
        />
      ) : (
        <Row
          title={title}
          subtitle={detail}
          value="Not set"
          accessibilityHint="Sets a date you can then change"
          separator={!error}
          onPress={fill}
        />
      )}
      {error ? (
        <>
          <Text variant="footnote" tone="destructive" style={styles.error}>
            {error}
          </Text>
          <Hairline />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  error: {
    paddingBottom: spacing.sm,
  },
});
