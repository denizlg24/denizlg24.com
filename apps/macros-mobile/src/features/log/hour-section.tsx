import { Pressable, StyleSheet, View } from "react-native";
import { showActionSheet } from "@/features/more/shared/action-sheet";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { formatHour } from "@/lib/log-time";
import { colors, hairline, Icon, spacing, Text } from "@/ui";
import { type EntryActions, EntryRow } from "./entry-row";
import { type HourGroup, sumEntries } from "./timeline";

export type HourAction = "select" | "copy-today" | "copy" | "move" | "meal";

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
  /** Acts on every entry of the hour at once. */
  onHourAction: (action: HourAction, ids: string[]) => void;
  /** In selection, ticks or unticks the whole hour. */
  onToggleHour: (ids: string[]) => void;
}

const HOUR_ACTIONS: ReadonlyArray<{
  action: HourAction;
  label: string;
  pastOnly?: boolean;
}> = [
  { action: "select", label: "Select" },
  { action: "copy-today", label: "Copy to today", pastOnly: true },
  { action: "copy", label: "Copy to…" },
  { action: "move", label: "Move…" },
  { action: "meal", label: "Save as meal" },
];

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
  onHourAction,
  onToggleHour,
}: HourSectionProps) {
  const label = formatHour(group.hour);
  const live = group.entries.filter((entry) => !pendingIds.has(entry.id));
  const ids = live.map((entry) => entry.id);
  const calories = sumEntries(live).calories;
  const allTicked = ids.length > 0 && ids.every((id) => selectedIds.has(id));

  const summary = (
    <>
      <Text variant="footnote" tone="secondary" eyebrow figure>
        {label}
      </Text>
      <View style={styles.rule} />
      <Text variant="footnote" tone="secondary" figure>
        {`${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`}
      </Text>
    </>
  );

  return (
    <View>
      {selecting ? (
        <Pressable
          onPress={() => onToggleHour(ids)}
          disabled={ids.length === 0}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allTicked }}
          accessibilityLabel={`Select everything at ${label}`}
          style={styles.header}
        >
          {summary}
          <Icon
            name={allTicked ? "circle-check" : "circle"}
            size={17}
            color={allTicked ? colors.label : colors.tertiaryLabel}
          />
        </Pressable>
      ) : (
        <View style={styles.header}>
          <Pressable
            onPress={() =>
              showActionSheet({
                title: label,
                actions: HOUR_ACTIONS.filter(
                  (item) => !(item.pastOnly && viewingToday),
                ).map((item) => ({
                  label: item.label,
                  onPress: () => onHourAction(item.action, ids),
                })),
              })
            }
            disabled={ids.length === 0}
            accessibilityRole="button"
            accessibilityLabel={`${label}, actions for this hour`}
            style={({ pressed }) => [
              styles.menuTrigger,
              pressed && styles.pressed,
            ]}
          >
            {summary}
          </Pressable>
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
        </View>
      )}
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
  menuTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  rule: {
    flex: 1,
    height: hairline,
    backgroundColor: colors.separator,
  },
});
