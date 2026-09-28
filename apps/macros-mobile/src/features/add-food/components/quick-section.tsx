import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { EnergyUnit } from "@/lib/format";
import { gutter, spacing, Text } from "@/ui";
import type { QuickItem } from "../search-rows";
import { FoodRow } from "./food-row";

export interface QuickHandlers {
  /** Puts the row's amount on the plate. */
  stage: (quick: QuickItem) => void;
  /** Logs the row's amount straight away. */
  logNow: (quick: QuickItem) => void;
  /** Opens the amount sheet on the row's amount. */
  open: (quick: QuickItem) => void;
}

export function ListHeading({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.heading}>
      <Text variant="title3" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text variant="subheadline" tone="secondary" style={styles.link}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A titled run of food rows that shows `cap` of them until asked for more. */
export function QuickSection({
  title,
  items,
  cap = items.length,
  energyUnit,
  handlers,
  children,
}: {
  title: string;
  items: readonly QuickItem[];
  cap?: number;
  energyUnit: EnergyUnit;
  handlers: QuickHandlers;
  /** Rows of another kind listed after the food rows. */
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0 && !children) return null;

  const visible = expanded ? items : items.slice(0, cap);
  const hidden = items.length - visible.length;

  return (
    <View>
      <ListHeading
        title={title}
        action={
          hidden > 0
            ? { label: `See ${hidden} More`, onPress: () => setExpanded(true) }
            : undefined
        }
      />
      <View style={styles.rows}>
        {visible.map((quick, index) => (
          <FoodRow
            key={quick.row.key}
            row={quick.row}
            energyUnit={energyUnit}
            onPress={() => handlers.open(quick)}
            onAdd={() => handlers.stage(quick)}
            swipeActions={[
              {
                label: "Log",
                icon: "check",
                onPress: () => handlers.logNow(quick),
              },
            ]}
            separator={index < visible.length - 1 || Boolean(children)}
          />
        ))}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },
  title: {
    flexShrink: 1,
  },
  link: {
    textDecorationLine: "underline",
  },
  rows: {
    paddingHorizontal: gutter,
  },
  pressed: {
    opacity: 0.6,
  },
});
