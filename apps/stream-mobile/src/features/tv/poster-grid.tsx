import type { TitleSummary } from "@repo/schemas/stream";
import { memo, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/ui";
import { PosterArt } from "./artwork";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { CONTENT_X, POSTER, SCREEN, TV_SAFE } from "./layout";
import { openTvTitle } from "./open";
import { TvText } from "./tv-text";

const GAP = 16;
export const GRID_COLUMNS = Math.floor(
  (SCREEN.width - CONTENT_X - TV_SAFE.x + GAP) / (POSTER.width + GAP),
);

/**
 * Posters in rows of a fixed count; each opens its title. Memoised, so
 * moving focus re-renders none of it. The last poster of each line keeps
 * focus on Right instead of jumping to the line below.
 */
export const TvPosterGrid = memo(function TvPosterGrid({
  titles,
  preferFirst = false,
  keyPrefix = "grid",
}: {
  titles: TitleSummary[];
  /** The first poster takes focus: for a screen that is nothing but the grid. */
  preferFirst?: boolean;
  keyPrefix?: string;
}) {
  return (
    <View style={styles.grid}>
      {titles.map((title, index) => (
        <Focusable
          key={title.id}
          focusKey={`${keyPrefix}:${title.id}`}
          preferred={preferFirst && index === 0}
          next={
            index % GRID_COLUMNS === GRID_COLUMNS - 1 ||
            index === titles.length - 1
              ? { right: "self" }
              : undefined
          }
          accessibilityRole="button"
          accessibilityLabel={title.title}
          onPress={() => openTvTitle(title.id)}
          radius={4}
          grow={1.07}
        >
          <PosterArt
            title={title}
            width={POSTER.width}
            height={POSTER.height}
          />
        </Focusable>
      ))}
    </View>
  );
});

/** A heading over a scrolling grid, with room for a footer (Show more). */
export function TvGridPage({
  heading,
  detail,
  loading,
  empty,
  children,
  footer,
}: {
  heading: string;
  detail?: string | null;
  loading?: boolean;
  /** Shown instead of the grid: a friendly dead end with its way out. */
  empty?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.head}>
        <TvText variant="heading" numberOfLines={1}>
          {heading}
        </TvText>
        {detail ? (
          <TvText variant="meta" color="muted" numberOfLines={1}>
            {detail}
          </TvText>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator
          color={colors.muted}
          size="large"
          style={styles.fill}
        />
      ) : empty ? (
        <View style={styles.empty}>{empty}</View>
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {children}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  head: {
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    paddingTop: TV_SAFE.y + spacing.sm,
    gap: spacing.xs,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM + spacing.xs,
  },
  content: { paddingBottom: TV_SAFE.y + spacing.xl },
  footer: { paddingLeft: CONTENT_X, flexDirection: "row" },
  empty: {
    flex: 1,
    justifyContent: "center",
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    paddingBottom: TV_SAFE.y + spacing.xxxl,
    gap: spacing.md,
    maxWidth: 680,
  },
});
