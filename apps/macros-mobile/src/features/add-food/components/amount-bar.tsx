import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { useSinglePress } from "@/lib/use-single-press";
import {
  colors,
  Icon,
  type IconName,
  radius,
  sheetGutter,
  spacing,
  Text,
} from "@/ui";
import { type AmountKey, parseAmount, pressAmountKey } from "../amount-input";
import {
  findOption,
  formatQuantityInput,
  quantityFor,
  type ServingOptions,
  servingsFor,
} from "../serving";

export interface AmountValue {
  optionId: string;
  text: string;
}

export interface AmountBarAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
}

export interface AmountBarProps {
  serving: ServingOptions;
  value: AmountValue;
  onChange: (next: AmountValue) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The quieter action beside the primary one: "Log Foods", "Remove". */
  secondary: AmountBarAction;
  primary: AmountBarAction;
}

type KeyCell =
  | { kind: "key"; key: AmountKey; label?: string; icon?: IconName }
  | { kind: "secondary" }
  | { kind: "primary" };

const KEY_ROWS: KeyCell[][] = [
  [
    { kind: "key", key: "1" },
    { kind: "key", key: "2" },
    { kind: "key", key: "3" },
    { kind: "key", key: "/" },
  ],
  [
    { kind: "key", key: "4" },
    { kind: "key", key: "5" },
    { kind: "key", key: "6" },
    { kind: "key", key: " ", label: "Space", icon: "space" },
  ],
  [
    { kind: "key", key: "7" },
    { kind: "key", key: "8" },
    { kind: "key", key: "9" },
    { kind: "key", key: "backspace", label: "Delete", icon: "delete" },
  ],
  [
    { kind: "key", key: "." },
    { kind: "key", key: "0" },
    { kind: "secondary" },
    { kind: "primary" },
  ],
];

const SYMBOL_KEYS: ReadonlySet<AmountKey> = new Set(["/", " ", "backspace"]);

/**
 * The amount and the sheet's actions, docked at the bottom. Closed it is one
 * row: the amount, the secondary action, the primary one. Open, the amount is
 * typed on our own keypad — fractions included — with the units above it and
 * the actions in its last row, so the system keyboard never covers them.
 */
export function AmountBar({
  serving,
  value,
  onChange,
  open,
  onOpenChange,
  secondary,
  primary,
}: AmountBarProps) {
  const insets = useSafeAreaInsets();
  const [replacing, setReplacing] = useState(open);
  const option = findOption(serving, value.optionId);
  const quantity = parseAmount(value.text);

  function toggle() {
    haptics.selection();
    setReplacing(!open);
    onOpenChange(!open);
  }

  function press(key: AmountKey) {
    haptics.selection();
    onChange({
      optionId: option.id,
      text: pressAmountKey(value.text, key, replacing),
    });
    setReplacing(false);
  }

  function switchUnit(nextId: string) {
    if (nextId === option.id) return;
    const next = findOption(serving, nextId);
    haptics.selection();
    const text =
      quantity != null && quantity > 0
        ? formatQuantityInput(quantityFor(servingsFor(quantity, option), next))
        : value.text;
    onChange({ optionId: next.id, text });
    setReplacing(true);
  }

  const field = (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={`Amount, ${value.text || "empty"} ${option.unit}`}
      accessibilityHint={open ? "Closes the keypad" : "Opens the keypad"}
      style={[styles.field, open && styles.fieldOpen]}
    >
      <View style={styles.fieldText}>
        {value.text === "" ? (
          <Text variant="title3" figure tone="tertiary">
            0
          </Text>
        ) : (
          <Text
            variant="title3"
            figure
            numberOfLines={1}
            style={open && replacing && styles.selected}
          >
            {value.text}
          </Text>
        )}
      </View>
      <Text variant="body" tone="secondary" numberOfLines={1}>
        {option.unit}
      </Text>
    </Pressable>
  );

  return (
    <View
      collapsable={false}
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
    >
      {open ? (
        <>
          {field}
          {serving.options.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.units}
              keyboardShouldPersistTaps="handled"
            >
              {serving.options.map((candidate) => {
                const selected = candidate.id === option.id;
                return (
                  <Pressable
                    key={candidate.id}
                    onPress={() => switchUnit(candidate.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={candidate.title}
                    style={[styles.unit, selected && styles.unitSelected]}
                  >
                    <Text
                      variant="subheadline"
                      weight="semibold"
                      tone={selected ? "onTint" : "primary"}
                      numberOfLines={1}
                    >
                      {candidate.unit}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <View style={styles.keypad}>
            {KEY_ROWS.map((row) => (
              <View key={row.map(cellKey).join()} style={styles.keyRow}>
                {row.map((cell) => {
                  if (cell.kind === "secondary") {
                    return (
                      <ActionKey
                        key="secondary"
                        action={secondary}
                        prominence="secondary"
                      />
                    );
                  }
                  if (cell.kind === "primary") {
                    return (
                      <ActionKey
                        key="primary"
                        action={primary}
                        prominence="primary"
                      />
                    );
                  }
                  return (
                    <Pressable
                      key={cell.key}
                      onPress={() => press(cell.key)}
                      accessibilityRole="button"
                      accessibilityLabel={cell.label ?? cell.key}
                      style={({ pressed }) => [
                        styles.key,
                        SYMBOL_KEYS.has(cell.key) && styles.symbolKey,
                        pressed && styles.keyPressed,
                      ]}
                    >
                      {cell.icon ? (
                        <Icon name={cell.icon} size={22} color={colors.label} />
                      ) : (
                        <Text variant="title2" figure weight="regular">
                          {cell.key}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.closed}>
          {field}
          <ActionKey action={secondary} prominence="secondary" compact />
          <ActionKey action={primary} prominence="primary" compact />
        </View>
      )}
    </View>
  );
}

function cellKey(cell: KeyCell): string {
  return cell.kind === "key" ? cell.key : cell.kind;
}

function ActionKey({
  action,
  prominence,
  compact = false,
}: {
  action: AmountBarAction;
  prominence: "primary" | "secondary";
  compact?: boolean;
}) {
  const press = useSinglePress(action.onPress);
  const inactive = Boolean(action.disabled || action.busy);
  const primary = prominence === "primary";
  return (
    <Pressable
      onPress={press}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: action.busy }}
      style={({ pressed }) => [
        styles.key,
        compact && styles.compactAction,
        primary ? styles.primaryKey : styles.symbolKey,
        pressed && styles.keyPressed,
        inactive && styles.inactive,
      ]}
    >
      {action.busy ? (
        <ActivityIndicator color={primary ? colors.onTint : colors.label} />
      ) : (
        <Text
          variant="headline"
          numberOfLines={1}
          adjustsFontSizeToFit
          tone={
            primary ? "onTint" : action.destructive ? "destructive" : "primary"
          }
        >
          {action.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: sheetGutter,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.background,
  },
  closed: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: colors.tertiaryFill,
  },
  fieldOpen: {
    flex: 0,
    borderColor: colors.label,
  },
  fieldText: {
    flex: 1,
    flexDirection: "row",
  },
  selected: {
    backgroundColor: colors.fill,
  },
  units: {
    gap: spacing.sm,
  },
  unit: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiaryFill,
  },
  unitSelected: {
    backgroundColor: colors.label,
  },
  keypad: {
    gap: spacing.xs,
  },
  keyRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  key: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.secondaryFill,
  },
  symbolKey: {
    backgroundColor: colors.tertiaryFill,
  },
  primaryKey: {
    backgroundColor: colors.label,
  },
  keyPressed: {
    opacity: 0.6,
  },
  compactAction: {
    flex: 0,
    paddingHorizontal: spacing.lg,
  },
  inactive: {
    opacity: 0.4,
  },
});
