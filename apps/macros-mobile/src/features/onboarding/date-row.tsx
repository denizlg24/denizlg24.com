import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, Hairline, Icon, Row, spacing, Text } from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";

const ISO_DATE = "yyyy-MM-dd";

/**
 * An optional date, Health-style: the row shows the value and tapping it
 * opens a wheel beneath. Opening an empty row fills in `defaultDate`, so what
 * the wheel shows is always what will be saved.
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
  const [open, setOpen] = useState(false);

  function toggle() {
    haptics.selection();
    if (!open && !value) onChange(format(defaultDate, ISO_DATE));
    setOpen(!open);
  }

  function clear() {
    haptics.selection();
    onChange(null);
    setOpen(false);
  }

  return (
    <View>
      <Row
        title={title}
        subtitle={detail}
        value={value ? format(parseISO(value), "d MMM yyyy") : "Not set"}
        valueTone={open ? "primary" : "secondary"}
        accessibilityHint={
          open ? "Hides the date picker" : "Shows a date picker"
        }
        separator={!open && !error}
        onPress={toggle}
        trailing={
          value ? (
            <Pressable
              onPress={clear}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${title.toLowerCase()}`}
            >
              <Icon name="circle-x" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ) : null
        }
      />
      {open ? (
        <DateTimePicker
          value={value ? parseISO(value) : defaultDate}
          mode="date"
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onValueChange={(_event, date) => onChange(format(date, ISO_DATE))}
        />
      ) : null}
      {error ? (
        <Text variant="footnote" tone="destructive" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {open || error ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    paddingBottom: spacing.sm,
  },
});
