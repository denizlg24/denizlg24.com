import { Pressable, StyleSheet, View } from "react-native";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { formatHour } from "@/lib/log-time";
import { colors, hairline, Icon, spacing, Text } from "@/ui";
import { type EntryActions, EntryRow } from "./entry-row";
import { type HourGroup, sumEntries } from "./timeline";

export interface HourSectionProps {
  group: HourGroup;
  timezone: string;
  energyUnit: EnergyUnit;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  pendingIds: ReadonlySet<string>;
  viewingToday: boolean;
  actions: EntryActions;
  onAdd: (hour: number) => void;
}

export function HourSection({
  group,
  timezone,
  energyUnit,
  selecting,
  selectedIds,
  pendingIds,
  viewingToday,
  actions,
  onAdd,
}: HourSectionProps) {
  const label = formatHour(group.hour);
  const calories = sumEntries(group.entries).calories;

  return (
    <View>
      <View style={styles.header}>
        <Text variant="footnote" tone="secondary" eyebrow figure>
          {label}
        </Text>
        <View style={styles.rule} />
        <Text variant="footnote" tone="secondary" figure>
          {`${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`}
        </Text>
        {selecting ? null : (
          <Pressable
            onPress={() => onAdd(group.hour)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Add food at ${label}`}
          >
            <Icon
              name="plus"
              size={17}
              weight="semibold"
              color={colors.label}
            />
          </Pressable>
        )}
      </View>
      {group.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          timezone={timezone}
          energyUnit={energyUnit}
          selecting={selecting}
          selected={selectedIds.has(entry.id)}
          pending={pendingIds.has(entry.id)}
          viewingToday={viewingToday}
          actions={actions}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rule: {
    flex: 1,
    height: hairline,
    backgroundColor: colors.separator,
  },
});
