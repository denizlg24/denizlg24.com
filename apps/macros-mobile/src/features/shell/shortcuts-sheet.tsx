import { type Href, router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { quickAddHref, weighInHref } from "@/features/today/links";
import { haptics } from "@/lib/haptics";
import {
  colors,
  gutter,
  Hairline,
  Icon,
  type IconName,
  spacing,
  Text,
} from "@/ui";

/** The add-food hub, opened on one of its tabs. */
function hubHref(open?: "recipes" | "library" | "shop"): Href {
  return open ? { pathname: "/add-food", params: { open } } : "/add-food";
}

const ACTIONS: ReadonlyArray<{ label: string; icon: IconName; href: Href }> = [
  { label: "Weight", icon: "scale", href: weighInHref() },
  { label: "Search", icon: "search", href: hubHref() },
  { label: "Barcode", icon: "barcode", href: "/scan" },
  { label: "Quick Add", icon: "zap", href: quickAddHref() },
];

const LINKS: ReadonlyArray<{
  label: string;
  icon: IconName;
  open: () => void;
}> = [
  {
    label: "Your Foods",
    icon: "book-open",
    open: () => router.replace(hubHref("library")),
  },
  {
    label: "Metrics",
    icon: "dumbbell",
    open: () => {
      router.back();
      router.navigate("/progress");
    },
  },
  {
    label: "Recipes",
    icon: "chef-hat",
    open: () => router.replace(hubHref("recipes")),
  },
  {
    label: "Shopping list",
    icon: "shopping-basket",
    open: () => router.replace(hubHref("shop")),
  },
];

/** What the tab bar's "+" opens: every way to add something, one tap away. */
export function ShortcutsSheet() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Icon name="x" size={20} weight="medium" color={colors.label} />
        </Pressable>
        <Text variant="title3" accessibilityRole="header" style={styles.title}>
          Shortcuts
        </Text>
        <View style={styles.close} />
      </View>
      <Hairline />

      <View style={styles.actions}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => {
              haptics.selection();
              router.replace(action.href);
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <View style={styles.round}>
              <Icon name={action.icon} size={24} color={colors.label} />
            </View>
            <Text variant="subheadline" numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.links}>
        {LINKS.map((link, index) => (
          <View key={link.label}>
            <Pressable
              onPress={() => {
                haptics.selection();
                link.open();
              }}
              accessibilityRole="link"
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Icon name={link.icon} size={22} color={colors.label} />
              <Text variant="title3" weight="regular" style={styles.linkLabel}>
                {link.label}
              </Text>
              <Icon
                name="chevron-right"
                size={14}
                weight="semibold"
                color={colors.tertiaryLabel}
              />
            </Pressable>
            {index < LINKS.length - 1 ? <Hairline /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: gutter,
    paddingVertical: spacing.xl,
  },
  action: {
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 72,
  },
  round: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondaryFill,
  },
  links: {
    paddingHorizontal: spacing.xxl,
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    minHeight: 56,
    paddingVertical: spacing.md,
  },
  linkLabel: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
