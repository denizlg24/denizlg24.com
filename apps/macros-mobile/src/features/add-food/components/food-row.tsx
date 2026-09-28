import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FoodIcon } from "@/components/food-icon";
import { type EnergyUnit, formatEnergy, formatInteger } from "@/lib/format";
import {
  colors,
  Flash,
  Hairline,
  Icon,
  type IconName,
  type SwipeAction,
  SwipeRow,
  spacing,
  Text,
} from "@/ui";
import { useLastLogged } from "../log-actions";
import type { MacroSnapshot } from "../serving";

export interface FoodRowData {
  /** Stable per row; also what a log from the row flashes. */
  key: string;
  name: string;
  brand?: string | null;
  iconKey?: string | null;
  entryType?: "food" | "recipe";
  /** "1 slice", "150 g", "3 foods". */
  amount: string;
  macros?: MacroSnapshot;
}

const ICON_SIZE = 36;

// Long enough to register, short enough that a second tap right after
// the first reads as another add rather than landing on a finished state.
const FLASH_MS = 300;

export function displayName(row: Pick<FoodRowData, "name" | "brand">): string {
  return row.brand ? `${row.name} By ${row.brand}` : row.name;
}

function TrailingButton({
  icon,
  doneIcon,
  label,
  onPress,
}: {
  icon: IconName;
  /** Flashed after each press, so a tap is acknowledged without locking the button. */
  doneIcon?: IconName;
  label: string;
  onPress: () => void;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const showDone = done && doneIcon !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        onPress();
        if (!doneIcon) return;
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), FLASH_MS);
      }}
      style={({ pressed }) => [
        styles.trailing,
        doneIcon && {
          backgroundColor: showDone ? colors.tint : colors.tertiaryFill,
        },
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={showDone && doneIcon ? doneIcon : icon}
        size={doneIcon ? 15 : 18}
        weight={doneIcon ? "semibold" : "regular"}
        color={
          showDone
            ? colors.onTint
            : doneIcon
              ? colors.label
              : colors.secondaryLabel
        }
      />
    </Pressable>
  );
}

/** "60 🔥 6P 4F 0C • 1 portion" */
function Summary({
  macros,
  amount,
  energyUnit,
}: {
  macros: MacroSnapshot | undefined;
  amount: string;
  energyUnit: EnergyUnit;
}) {
  return (
    <View style={styles.summary}>
      {macros ? (
        <>
          <View style={styles.energy}>
            <Text variant="subheadline" tone="secondary" figure>
              {formatEnergy(macros.calories, energyUnit)}
            </Text>
            <Icon name="flame" size={12} color={colors.secondaryLabel} />
          </View>
          <Text variant="subheadline" tone="secondary" figure>
            {`${formatInteger(macros.protein)}P  ${formatInteger(macros.fat)}F  ${formatInteger(macros.carbs)}C`}
          </Text>
          <Text variant="subheadline" tone="secondary">
            •
          </Text>
        </>
      ) : null}
      <Text
        variant="subheadline"
        tone="secondary"
        numberOfLines={1}
        style={styles.amount}
      >
        {amount}
      </Text>
    </View>
  );
}

export function FoodRow({
  row,
  energyUnit,
  onPress,
  onAdd,
  addLabel,
  onRemove,
  swipeActions,
  separator = true,
}: {
  row: FoodRowData;
  energyUnit: EnergyUnit;
  onPress?: () => void;
  /** The trailing "+": puts exactly the amount the row shows on the plate. */
  onAdd?: () => void;
  addLabel?: string;
  /** A trailing trash button instead of the "+". */
  onRemove?: () => void;
  swipeActions?: SwipeAction[];
  separator?: boolean;
}) {
  const lastLogged = useLastLogged();
  const flashToken = lastLogged?.key === row.key ? lastLogged.at : null;
  const name = displayName(row);

  const content = (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityHint={onPress ? "Opens amount and nutrition" : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress && styles.rowPressed,
      ]}
    >
      <FoodIcon
        name={row.name}
        iconKey={row.iconKey}
        entryType={row.entryType}
        size={ICON_SIZE}
      />
      <View style={styles.text}>
        <Text variant="body" weight="semibold" numberOfLines={1}>
          {name}
        </Text>
        <Summary
          macros={row.macros}
          amount={row.amount}
          energyUnit={energyUnit}
        />
      </View>
      {onAdd ? (
        <TrailingButton
          icon="plus"
          doneIcon="check"
          label={addLabel ?? `Add ${row.amount} of ${name} to the plate`}
          onPress={onAdd}
        />
      ) : onRemove ? (
        <TrailingButton
          icon="trash"
          label={`Remove ${name}`}
          onPress={onRemove}
        />
      ) : null}
    </Pressable>
  );

  // Inside the swipe row: its opaque background would otherwise hide the tint.
  const flashed = <Flash token={flashToken}>{content}</Flash>;

  return (
    <View>
      {swipeActions && swipeActions.length > 0 ? (
        <SwipeRow actions={swipeActions}>{flashed}</SwipeRow>
      ) : (
        flashed
      )}
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  rowPressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  energy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  amount: {
    flexShrink: 1,
  },
  trailing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
