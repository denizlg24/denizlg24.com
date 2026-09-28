import { MenuView } from "@expo/ui/community/menu";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  FOOD_ICON_GROUPS,
  type FoodIconGroup,
  groupOfIcon,
  useFoodIconCatalog,
} from "@/api/food-icons";
import { FoodIcon } from "@/components/food-icon";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import {
  colors,
  gutter,
  Hairline,
  Icon,
  InlineNotice,
  radius,
  Skeleton,
  spacing,
  Text,
} from "@/ui";

const COLUMNS = 6;
// The smallest food group fills four rows, so a grid that loads never draws
// shorter than this placeholder did.
const PLACEHOLDERS = Array.from(
  { length: COLUMNS * 4 },
  (_, index) => `placeholder-${index}`,
);
const ICON_SCALE = 0.62;

export function IconPicker({
  value,
  name,
  onChange,
}: {
  value: string;
  /** The food's name, for the glyph shown before an icon is chosen. */
  name: string;
  onChange: (iconKey: string) => void;
}) {
  const catalog = useFoodIconCatalog();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<FoodIconGroup>(() => groupOfIcon(value));
  const cell = Math.floor((width - gutter * 2) / COLUMNS);
  const groupLabel =
    FOOD_ICON_GROUPS.find((candidate) => candidate.id === group)?.label ??
    "Other";
  const icons = (catalog.data ?? []).filter(
    (icon) => groupOfIcon(icon.key) === group,
  );

  return (
    <View>
      <Pressable
        onPress={() => {
          haptics.selection();
          setOpen((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Icon. Change icon"
        style={({ pressed }) => [styles.current, pressed && styles.pressed]}
      >
        <FoodIcon name={name || "food"} iconKey={value} size={40} />
        <Text variant="body" style={styles.flex}>
          {open ? "Choose an icon" : "Icon"}
        </Text>
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={13}
          weight="semibold"
          color={colors.tertiaryLabel}
        />
      </Pressable>
      <Hairline />
      {open ? (
        <View style={styles.body}>
          <MenuView
            title="Food group"
            actions={FOOD_ICON_GROUPS.map((candidate) => ({
              id: candidate.id,
              title: candidate.label,
              state: candidate.id === group ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => {
              const next = FOOD_ICON_GROUPS.find(
                (candidate) => candidate.id === nativeEvent.event,
              );
              if (!next) return;
              haptics.selection();
              setGroup(next.id);
            }}
          >
            <View
              style={styles.group}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Food group: ${groupLabel}. Change group`}
            >
              <Text variant="subheadline" weight="semibold">
                {groupLabel}
              </Text>
              <Icon
                name="chevrons-up-down"
                size={12}
                weight="semibold"
                color={colors.secondaryLabel}
              />
            </View>
          </MenuView>
          {catalog.isError ? (
            <InlineNotice
              message={`Icons didn’t load. ${errorMessage(catalog.error)}`}
              action={{ label: "Retry", onPress: () => void catalog.refetch() }}
            />
          ) : catalog.isPending ? (
            <View
              style={styles.grid}
              accessible
              accessibilityLabel="Loading icons"
            >
              {PLACEHOLDERS.map((placeholder) => (
                <View
                  key={placeholder}
                  style={[styles.cell, { width: cell, height: cell }]}
                >
                  <Skeleton
                    width={cell * ICON_SCALE}
                    height={cell * ICON_SCALE}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.grid}>
              {icons.map((icon) => {
                const selected = icon.key === value;
                return (
                  <Pressable
                    key={icon.key}
                    onPress={() => {
                      haptics.selection();
                      onChange(icon.key);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${groupLabel} icon ${icon.key.split("-").at(-1) ?? ""}`}
                    accessibilityState={{ selected }}
                    style={[
                      styles.cell,
                      { width: cell, height: cell },
                      selected && styles.selected,
                    ]}
                  >
                    <FoodIcon
                      name={name || "food"}
                      iconKey={icon.key}
                      size={cell * ICON_SCALE}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  current: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  pressed: {
    opacity: 0.6,
  },
  flex: {
    flex: 1,
  },
  body: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 32,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  selected: {
    backgroundColor: colors.tertiaryFill,
  },
});
