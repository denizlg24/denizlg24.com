import { MenuView } from "@expo/ui/community/menu";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, Hairline, Icon, spacing, Text } from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";

export interface Option<T> {
  value: T;
  label: string;
}

/** The native segmented control, typed by its option values. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
}) {
  return (
    <SegmentedControl
      values={options.map((option) => option.label)}
      selectedIndex={Math.max(
        0,
        options.findIndex((option) => option.value === value),
      )}
      onChange={(event) => {
        const next = options[event.nativeEvent.selectedSegmentIndex];
        if (!next || next.value === value) return;
        haptics.selection();
        onChange(next.value);
      }}
      style={[styles.segmented, style]}
    />
  );
}

/**
 * A settings row whose value opens a native menu — the iOS pop-up button.
 * Used instead of a picker page for short enumerations.
 */
export function MenuRow<T extends string | number>({
  title,
  subtitle,
  value,
  options,
  onChange,
  separator = true,
}: {
  title: string;
  subtitle?: string;
  value: T;
  options: ReadonlyArray<Option<T> & { subtitle?: string }>;
  onChange: (value: T) => void;
  separator?: boolean;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="body">{title}</Text>
          {subtitle ? (
            <Text variant="footnote" tone="secondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <MenuView
          title={title}
          actions={options.map((option) => ({
            id: String(option.value),
            title: option.label,
            state: option.value === value ? "on" : "off",
          }))}
          onPressAction={({ nativeEvent }) => {
            const next = options.find(
              (option) => String(option.value) === nativeEvent.event,
            );
            if (!next || next.value === value) return;
            haptics.selection();
            onChange(next.value);
          }}
        >
          <View
            style={styles.menuValue}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${current?.label ?? ""}`}
          >
            <Text variant="body" tone="secondary">
              {current?.label ?? "—"}
            </Text>
            <Icon
              name="chevrons-up-down"
              size={12}
              weight="semibold"
              color={colors.tertiaryLabel}
            />
          </View>
        </MenuView>
      </View>
      {separator ? <Hairline /> : null}
    </View>
  );
}

/** Seven day toggles, Monday first, for picking days of the week. */
export function WeekdayToggles({
  selected,
  onToggle,
  labels,
}: {
  selected: readonly number[];
  onToggle: (weekday: number) => void;
  /** Accessible names, index-aligned with the weekday numbers used by `selected`. */
  labels: readonly string[];
}) {
  return (
    <View style={styles.weekdays}>
      {labels.map((name, weekday) => {
        const on = selected.includes(weekday);
        return (
          <Pressable
            key={name}
            accessibilityRole="checkbox"
            accessibilityLabel={name}
            accessibilityState={{ checked: on }}
            hitSlop={4}
            onPress={() => {
              haptics.selection();
              onToggle(weekday);
            }}
            style={({ pressed }) => [
              styles.weekday,
              { backgroundColor: on ? colors.tint : colors.tertiaryFill },
              pressed && styles.pressed,
            ]}
          >
            <Text
              variant="subheadline"
              weight="semibold"
              tone={on ? "onTint" : "primary"}
            >
              {name.slice(0, 1)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    alignSelf: "stretch",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  menuValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  weekdays: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekday: {
    minWidth: 38,
    minHeight: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
