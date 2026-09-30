import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FoodIcon } from "@/components/food-icon";
import { MacroInline } from "@/components/macro-bars";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import {
  colors,
  gutter,
  Hairline,
  Section,
  type SectionProps,
  spacing,
  Text,
  useSwipeAccessibility,
} from "@/ui";

export interface FoodListRowProps {
  name: string;
  iconKey?: string | null;
  entryType?: "food" | "recipe";
  /** Secondary line, e.g. brand and serving. */
  detail?: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  energyUnit: EnergyUnit;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
}

/** Icon, name, detail and per-serving macros; edge to edge with its own gutter. */
export function FoodListRow({
  name,
  iconKey,
  entryType = "food",
  detail,
  calories,
  protein,
  carbs,
  fat,
  energyUnit,
  trailing,
  onPress,
  onLongPress,
  accessibilityHint,
}: FoodListRowProps) {
  const swipeAccessibility = useSwipeAccessibility();
  const energy =
    calories === null
      ? "—"
      : `${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`;

  return (
    <View>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={!onPress && !onLongPress}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityHint={accessibilityHint}
        {...swipeAccessibility}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.fill },
        ]}
      >
        <FoodIcon
          name={name}
          iconKey={iconKey}
          entryType={entryType}
          size={34}
        />
        <View style={styles.text}>
          <Text variant="body" numberOfLines={2}>
            {name}
          </Text>
          {detail ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
          <MacroInline
            protein={protein ?? 0}
            carbs={carbs ?? 0}
            fat={fat ?? 0}
          />
        </View>
        <Text variant="subheadline" tone="secondary" figure>
          {energy}
        </Text>
        {trailing}
      </Pressable>
      <Hairline inset={gutter} />
    </View>
  );
}

/** What a row turns into while its removal can still be taken back. */
export function UndoRow({
  label,
  onUndo,
}: {
  label: string;
  onUndo: () => void;
}) {
  return (
    <View>
      <View style={[styles.row, styles.undo]}>
        <Text
          variant="subheadline"
          tone="secondary"
          numberOfLines={1}
          style={styles.text}
        >
          {label}
        </Text>
        <Pressable
          onPress={onUndo}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Undo: ${label}`}
        >
          <Text variant="subheadline" weight="semibold">
            Undo
          </Text>
        </Pressable>
      </View>
      <Hairline inset={gutter} />
    </View>
  );
}

/**
 * A `Section` for edge-to-edge lists: the heading keeps the gutter while the
 * rows (and their swipe actions) run to the screen edges.
 */
export function ListSection({
  title,
  action,
  footer,
  children,
}: {
  title?: string;
  action?: SectionProps["action"];
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View>
      {title ? (
        <Section title={title} action={action} style={styles.inset}>
          {null}
        </Section>
      ) : null}
      {children}
      {footer ? (
        <Text variant="footnote" tone="secondary" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: gutter,
    paddingVertical: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  undo: {
    backgroundColor: colors.quaternaryFill,
  },
  inset: {
    paddingHorizontal: gutter,
  },
  footer: {
    paddingHorizontal: gutter,
    marginTop: spacing.sm,
  },
});
