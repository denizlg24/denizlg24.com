import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAudience } from "@/lib/audience-store";
import { AudienceDiscs, colors, gutter, spacing, Wordmark } from "@/ui";

/**
 * Every studio surface opens with the wordmark on the left and the audience
 * on the right; tapping the discs goes back to the sofa.
 */
export function StudioHeader({
  actions,
  floating,
}: {
  actions?: ReactNode;
  /** Over imagery: no background, so the art runs under the status bar. */
  floating?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { audience } = useAudience();
  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + spacing.sm },
        floating ? styles.floating : styles.solid,
      ]}
    >
      <View style={styles.mark}>
        <Wordmark size={24} />
      </View>
      {actions}
      <AudienceDiscs audience={audience} onPress={() => router.push("/sofa")} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
  },
  solid: {
    backgroundColor: colors.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  floating: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  mark: { flex: 1 },
});
