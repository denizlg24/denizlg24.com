import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, gutter, spacing, Text, Wordmark } from "@/ui";

/** The full-screen moments before the catalogue: sign in, not invited, can't connect. */
export function GateScreen({
  icon: Icon,
  title,
  message,
  children,
}: {
  /** Drawn under the wordmark; the sign-in screen has none. */
  icon?: LucideIcon;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: colors.ink }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Wordmark size={30} />
      <View style={styles.copy}>
        {Icon ? (
          <Icon color={colors.amber} size={40} strokeWidth={1.5} />
        ) : null}
        <Text variant="hero">{title}</Text>
        <Text variant="lede" color="muted">
          {message}
        </Text>
      </View>
      <View style={styles.actions}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: gutter + spacing.xs,
    gap: spacing.xxxl,
  },
  copy: { flex: 1, gap: spacing.lg, justifyContent: "center" },
  actions: { gap: spacing.md },
});
