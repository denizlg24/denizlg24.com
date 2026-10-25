import { type TitleSummary, tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Search } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { audienceNames } from "@/lib/audience";
import { useAudience } from "@/lib/audience-store";
import { titleFacts } from "@/lib/format";
import { progressFraction } from "@/lib/time";
import {
  Avatar,
  colors,
  MetaRow,
  Poster,
  Still,
  spacing,
  Text,
  Wordmark,
} from "@/ui";
import { Focusable } from "./focusable";
import { RAIL_GAP, RAIL_POSTER, TV_SAFE } from "./layout";

export type TvSection = "home" | "search" | "list";

const SECTIONS: { key: TvSection; label: string; href: string }[] = [
  { key: "home", label: "Home", href: "/tv" },
  { key: "search", label: "Search", href: "/tv/search" },
  { key: "list", label: "My list", href: "/tv/list" },
];

/** Along the top of every browsing screen: where you are, and who's watching. */
export function TvNavBar({
  current,
  preferred = false,
}: {
  current: TvSection;
  /** Takes focus on arrival, for a screen whose content starts empty. */
  preferred?: boolean;
}) {
  const { audience } = useAudience();
  return (
    <View style={styles.nav}>
      <Wordmark size={24} />
      <View style={styles.sections}>
        {SECTIONS.map((section) => (
          <Focusable
            key={section.key}
            preferred={preferred && section.key === current}
            accessibilityRole="tab"
            accessibilityLabel={section.label}
            accessibilityState={{ selected: section.key === current }}
            onPress={() => {
              if (section.key !== current) router.replace(section.href);
            }}
            style={styles.section}
            radius={6}
          >
            {section.key === "search" ? (
              <Search
                size={16}
                color={section.key === current ? colors.amber : colors.muted}
              />
            ) : null}
            <Text
              variant="callout"
              color={section.key === current ? "amber" : "muted"}
            >
              {section.label}
            </Text>
          </Focusable>
        ))}
      </View>
      <Focusable
        accessibilityRole="button"
        accessibilityLabel={`Watching: ${audienceNames(audience)}. Change who's watching`}
        onPress={() => router.push("/tv/who")}
        style={styles.audience}
        radius={20}
      >
        {audience.map((profile) => (
          <Avatar
            key={profile.id}
            name={profile.name}
            color={profile.color}
            size={32}
          />
        ))}
        <Text variant="callout" color="muted" numberOfLines={1}>
          {audienceNames(audience)}
        </Text>
      </Focusable>
    </View>
  );
}

/** The focused title's backdrop fills the screen, faded into ink below and left. */
export function TvBackdrop({ title }: { title: TitleSummary | null }) {
  const uri = title
    ? (tmdbImage(title.backdropPath, "w1280") ??
      tmdbImage(title.posterPath, "w780"))
    : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
      ) : null}
      <LinearGradient
        colors={[
          "rgba(12,11,10,0.92)",
          "rgba(12,11,10,0.55)",
          "rgba(12,11,10,0)",
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(12,11,10,0)", "rgba(12,11,10,0.85)", colors.ink]}
        locations={[0.25, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Name, facts and a line of why, for whatever the remote is resting on. */
export function TvSpotlight({
  title,
  reason,
  children,
}: {
  title: TitleSummary | null;
  reason?: string | null;
  children?: ReactNode;
}) {
  return (
    <View style={styles.spotlight}>
      {title ? (
        <>
          <Text variant="display" numberOfLines={1}>
            {title.title}
          </Text>
          <MetaRow facts={titleFacts(title)} />
          {reason ? (
            <Text variant="body" color="muted" numberOfLines={2}>
              {reason}
            </Text>
          ) : null}
        </>
      ) : null}
      {children}
    </View>
  );
}

export interface RailItem {
  key: string;
  title: TitleSummary;
  reason?: string;
  /** Continue watching: drawn as a landscape still with a progress bar. */
  progress?: { positionS: number; durationS: number };
  onPress: () => void;
}

/** One labelled row of posters; Android scrolls it to keep focus in view. */
export function TvRail({
  label,
  items,
  onFocusItem,
}: {
  label: string;
  items: RailItem[];
  onFocusItem: (item: RailItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.rail}>
      <Text variant="title" style={styles.railLabel}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
      >
        {items.map((item) => (
          <Focusable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.title.title}
            onPress={item.onPress}
            onFocus={() => onFocusItem(item)}
            radius={4}
          >
            {item.progress ? (
              <Still
                title={item.title}
                width={RAIL_POSTER * 1.7}
                progress={progressFraction(
                  item.progress.positionS,
                  item.progress.durationS,
                )}
              />
            ) : (
              <Poster title={item.title} width={RAIL_POSTER} />
            )}
          </Focusable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxxl,
    paddingHorizontal: TV_SAFE.x,
    paddingTop: TV_SAFE.y,
    paddingBottom: spacing.md,
  },
  sections: { flex: 1, flexDirection: "row", gap: spacing.md },
  section: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  audience: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    maxWidth: 300,
  },
  spotlight: {
    paddingHorizontal: TV_SAFE.x,
    gap: spacing.sm,
    maxWidth: 560,
  },
  rail: { gap: spacing.md },
  railLabel: { paddingHorizontal: TV_SAFE.x },
  railContent: {
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: spacing.sm,
    gap: RAIL_GAP,
  },
});
