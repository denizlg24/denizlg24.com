import { router } from "expo-router";
import {
  TabList,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabTriggerSlotProps,
} from "expo-router/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudience } from "@/lib/audience-store";
import { Avatar, colors, gutter, radius, spacing, Text } from "@/ui";

/**
 * Classic: big labelled buttons along the top — Home, Search, Ask, My list
 * — and the person watching, which opens the sofa to change who it is.
 */
export default function ClassicLayout() {
  const insets = useSafeAreaInsets();
  const { lead } = useAudience();
  return (
    <Tabs style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Watching as ${lead.name}. Change person`}
          onPress={() => router.push("/sofa")}
          style={({ pressed }) => [styles.who, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Avatar name={lead.name} color={lead.color} size={40} />
          <Text variant="classicLabel">{lead.name}</Text>
          <Text variant="classicBody" color="amber" style={styles.change}>
            Change person
          </Text>
        </Pressable>
        <TabList style={styles.tabs}>
          <TabTrigger name="home" href="/home" asChild>
            <TabButton label="Home" />
          </TabTrigger>
          <TabTrigger name="search" href="/search" asChild>
            <TabButton label="Search" />
          </TabTrigger>
          <TabTrigger name="ideas" href="/ideas" asChild>
            <TabButton label="Ask" />
          </TabTrigger>
          <TabTrigger name="list" href="/list" asChild>
            <TabButton label="My list" />
          </TabTrigger>
        </TabList>
      </View>
      <TabSlot />
    </Tabs>
  );
}

function TabButton({
  label,
  isFocused,
  ...props
}: TabTriggerSlotProps & { label: string }) {
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [
        styles.tab,
        {
          backgroundColor: isFocused ? colors.paper : colors.raised,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        variant="classicLabel"
        style={{ color: isFocused ? colors.ink : colors.paper }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  top: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
  },
  change: { marginLeft: "auto" },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
