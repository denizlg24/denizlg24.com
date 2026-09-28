import { Pressable, StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { colors, Hairline, Icon, type IconName, spacing, Text } from "@/ui";

const HUB_TABS = ["search", "recipes", "library", "shop"] as const;

export type HubTab = (typeof HUB_TABS)[number];

export function isHubTab(value: unknown): value is HubTab {
  return HUB_TABS.some((tab) => tab === value);
}

type Item =
  | { kind: "action"; key: "scan"; label: string; icon: IconName }
  | { kind: "tab"; key: HubTab; label: string; icon: IconName };

const ITEMS: readonly Item[] = [
  { kind: "action", key: "scan", label: "Scan", icon: "barcode" },
  { kind: "tab", key: "search", label: "Search", icon: "search" },
  { kind: "tab", key: "recipes", label: "Recipes", icon: "chef-hat" },
  { kind: "tab", key: "library", label: "Library", icon: "book-open" },
  { kind: "tab", key: "shop", label: "Shop", icon: "shopping-basket" },
];

/**
 * Every way into the log from one strip. Scan is a camera, so it opens over
 * the hub instead of becoming a tab of it.
 */
export function HubTabs({
  value,
  onChange,
  onScan,
}: {
  value: HubTab;
  onChange: (tab: HubTab) => void;
  onScan: () => void;
}) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      <View style={styles.row}>
        {ITEMS.map((item) => {
          const selected = item.kind === "tab" && item.key === value;
          return (
            <Pressable
              key={item.key}
              accessibilityRole={item.kind === "tab" ? "tab" : "button"}
              accessibilityState={
                item.kind === "tab" ? { selected } : undefined
              }
              accessibilityLabel={
                item.kind === "action" ? "Scan a barcode" : item.label
              }
              onPress={() => {
                if (item.kind === "action") {
                  onScan();
                  return;
                }
                if (selected) return;
                haptics.selection();
                onChange(item.key);
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <View style={styles.content}>
                <Icon
                  name={item.icon}
                  size={14}
                  color={selected ? colors.label : colors.secondaryLabel}
                />
                <Text
                  variant="footnote"
                  tone={selected ? "primary" : "secondary"}
                  weight={selected ? "semibold" : "regular"}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </View>
              <View
                style={[
                  styles.indicator,
                  { backgroundColor: selected ? colors.label : "transparent" },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <Hairline />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: "row",
  },
  item: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  indicator: {
    alignSelf: "stretch",
    marginHorizontal: spacing.sm,
    height: 2,
    borderRadius: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
