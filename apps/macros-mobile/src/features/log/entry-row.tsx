import { formatLoggedAmount } from "@repo/macros-core/foods/display";
import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { Link, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FoodIcon } from "@/components/food-icon";
import { MacroInline } from "@/components/macro-bars";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { formatTimeOfDay } from "@/lib/log-time";
import { colors, Flash, Hairline, Icon, SwipeRow, spacing, Text } from "@/ui";
import { useEntryFlashToken } from "./flash";

export interface EntryActions {
  onDelete: (entry: MacrosFoodLogEntry) => void;
  onDuplicate: (entry: MacrosFoodLogEntry) => void;
  onMove: (entry: MacrosFoodLogEntry) => void;
  onCopyToToday: (entry: MacrosFoodLogEntry) => void;
  onUndo: (entry: MacrosFoodLogEntry) => void;
  onToggle: (entry: MacrosFoodLogEntry) => void;
}

export interface EntryRowProps {
  entry: MacrosFoodLogEntry;
  timezone: string;
  energyUnit: EnergyUnit;
  selecting: boolean;
  selected: boolean;
  /** Deleted, but still inside its undo window. */
  pending: boolean;
  viewingToday: boolean;
  actions: EntryActions;
}

export function entryHref(entry: Pick<MacrosFoodLogEntry, "id" | "logDate">) {
  return {
    pathname: "/entry/[id]",
    params: { id: entry.id, date: entry.logDate },
  } as const;
}

function EntryContent({
  entry,
  timezone,
  energyUnit,
  leading,
}: {
  entry: MacrosFoodLogEntry;
  timezone: string;
  energyUnit: EnergyUnit;
  leading?: ReactNode;
}) {
  const time = entry.eatenAt ? formatTimeOfDay(entry.eatenAt, timezone) : null;
  const amount = formatLoggedAmount(entry);
  return (
    <View style={styles.content}>
      {leading}
      <FoodIcon
        name={entry.foodName}
        iconKey={entry.iconKey}
        entryType={entry.entryType}
        size={34}
      />
      <View style={styles.text}>
        <Text variant="body" numberOfLines={1}>
          {entry.foodName}
        </Text>
        <Text variant="footnote" tone="secondary" figure numberOfLines={1}>
          {[amount, entry.brand, time].filter(Boolean).join(" · ")}
        </Text>
        <MacroInline
          protein={entry.protein}
          carbs={entry.carbs}
          fat={entry.fat}
        />
      </View>
      <View style={styles.energy}>
        <Text variant="headline" figure>
          {formatEnergy(entry.calories, energyUnit)}
        </Text>
        <Text variant="caption2" tone="secondary">
          {energyLabel(energyUnit)}
        </Text>
      </View>
    </View>
  );
}

export function EntryRow({
  entry,
  timezone,
  energyUnit,
  selecting,
  selected,
  pending,
  viewingToday,
  actions,
}: EntryRowProps) {
  const router = useRouter();
  const flashToken = useEntryFlashToken(entry.id);
  const href = entryHref(entry);

  if (pending) {
    return (
      <View>
        <View style={[styles.content, styles.pending]}>
          <Text
            variant="body"
            tone="secondary"
            numberOfLines={1}
            style={styles.removedName}
          >
            {entry.foodName}
          </Text>
          <Pressable
            onPress={() => actions.onUndo(entry)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Undo deleting ${entry.foodName}`}
          >
            <Text variant="subheadline" weight="semibold">
              Undo
            </Text>
          </Pressable>
        </View>
        <Hairline inset={46} />
      </View>
    );
  }

  if (selecting) {
    return (
      <Flash token={flashToken}>
        <Pressable
          onPress={() => actions.onToggle(entry)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={entry.foodName}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <EntryContent
            entry={entry}
            timezone={timezone}
            energyUnit={energyUnit}
            leading={
              <Icon
                name={selected ? "circle-check" : "circle"}
                size={22}
                color={selected ? colors.label : colors.tertiaryLabel}
              />
            }
          />
        </Pressable>
        <Hairline inset={46} />
      </Flash>
    );
  }

  return (
    <SwipeRow
      actions={[
        {
          label: "Delete",
          icon: "trash",
          destructive: true,
          onPress: () => actions.onDelete(entry),
        },
        {
          label: "Duplicate",
          icon: "copy-plus",
          onPress: () => actions.onDuplicate(entry),
        },
      ]}
    >
      <Flash token={flashToken}>
        <Link href={href} asChild>
          <Link.Trigger>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the entry. Long press for more actions."
              style={({ pressed }) => pressed && styles.pressed}
            >
              <EntryContent
                entry={entry}
                timezone={timezone}
                energyUnit={energyUnit}
              />
            </Pressable>
          </Link.Trigger>
          <Link.Menu title={entry.foodName}>
            <Link.MenuAction icon="pencil" onPress={() => router.push(href)}>
              Edit
            </Link.MenuAction>
            <Link.MenuAction
              icon="plus.square.on.square"
              onPress={() => actions.onDuplicate(entry)}
            >
              Duplicate
            </Link.MenuAction>
            <Link.MenuAction
              icon="clock.arrow.circlepath"
              onPress={() => actions.onMove(entry)}
            >
              Move…
            </Link.MenuAction>
            <Link.MenuAction
              icon="doc.on.doc"
              hidden={viewingToday}
              onPress={() => actions.onCopyToToday(entry)}
            >
              Copy to today
            </Link.MenuAction>
            <Link.MenuAction
              icon="trash"
              destructive
              onPress={() => actions.onDelete(entry)}
            >
              Delete
            </Link.MenuAction>
          </Link.Menu>
        </Link>
        <Hairline inset={46} />
      </Flash>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  energy: {
    alignItems: "flex-end",
  },
  pending: {
    minHeight: 58,
  },
  removedName: {
    flex: 1,
    textDecorationLine: "line-through",
  },
  pressed: {
    backgroundColor: colors.fill,
  },
});
