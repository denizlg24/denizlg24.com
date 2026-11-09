import { router } from "expo-router";
import { Search } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { audienceNames } from "@/lib/audience";
import { useAudience } from "@/lib/audience-store";
import {
  AudienceDiscs,
  Avatar,
  colors,
  IconButton,
  spacing,
  Text,
  Wordmark,
} from "@/ui";
import { EDGE } from "./metrics";

export const TOP_BAR_HEIGHT = 52;

/**
 * Wordmark (or a screen's name), Search and whoever is watching. Over
 * artwork it starts clear and darkens as the page scrolls under it.
 */
export function TopBar({
  title,
  scrollY,
  children,
}: {
  /** A screen name in place of the wordmark. */
  title?: string;
  /** When given, the bar floats and fades in its background with the scroll. */
  scrollY?: SharedValue<number>;
  /** Drawn under the bar, inside the same background: the filter chips. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const backdrop = useAnimatedStyle(() => ({
    opacity: scrollY
      ? interpolate(scrollY.value, [0, 90], [0, 0.96], "clamp")
      : 1,
  }));
  return (
    <View
      style={[scrollY ? styles.floating : null, { paddingTop: insets.top }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}
      />
      <View style={styles.bar}>
        {title ? (
          <Text
            variant="title"
            numberOfLines={1}
            style={styles.title}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : (
          <View style={styles.title}>
            <Wordmark size={26} />
          </View>
        )}
        <IconButton
          icon={Search}
          label="Search"
          size={24}
          onPress={() => router.push("/search")}
        />
        <WhoButton />
      </View>
      {children}
    </View>
  );
}

/** The lead's square, or everyone's discs when several are watching; opens "Who's watching?". */
function WhoButton() {
  const { audience, lead } = useAudience();
  const open = () => router.push("/who");
  if (audience.length > 1) {
    return <AudienceDiscs audience={audience} size={26} onPress={open} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Watching as ${audienceNames([lead])}. Switch profile`}
      hitSlop={10}
      onPress={open}
      style={({ pressed }) => [styles.who, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Avatar name={lead.name} color={lead.color} size={28} square />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  backdrop: { backgroundColor: colors.ink },
  bar: {
    height: TOP_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: EDGE,
    paddingRight: EDGE - spacing.xs,
    gap: spacing.xs,
  },
  title: { flex: 1, minWidth: 0 },
  who: { marginLeft: spacing.xs },
});
