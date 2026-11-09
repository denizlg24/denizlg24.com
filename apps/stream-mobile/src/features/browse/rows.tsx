import {
  type BrowseRow,
  type ContinueWatchingItem,
  type TitleSummary,
  tmdbImage,
} from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight, Info, Play } from "lucide-react-native";
import { memo, type ReactNode, useCallback } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { openGrid, openTitle, playTitle } from "@/features/title/open";
import { progressFraction } from "@/lib/time";
import {
  colors,
  fonts,
  Poster,
  ProgressLine,
  radius,
  Skeleton,
  Still,
  spacing,
  Text,
} from "@/ui";
import { EDGE, GAP, type RowMetrics } from "./metrics";

/** One browse row of whichever kind the server sent. */
export const BrowseRowView = memo(function BrowseRowView({
  row,
  metrics,
}: {
  row: BrowseRow;
  metrics: RowMetrics;
}) {
  if (row.items.length === 0) return null;
  const more = row.kind === "titles" ? (row.more ?? null) : null;
  return (
    <View style={styles.row}>
      <RowHeader label={row.label} more={more} />
      {row.kind === "continue" ? (
        <ContinueRow items={row.items} metrics={metrics} />
      ) : row.kind === "top10" ? (
        <Top10Row items={row.items} metrics={metrics} />
      ) : row.wide ? (
        <WideRow items={row.items} metrics={metrics} />
      ) : (
        <PosterRow items={row.items} metrics={metrics} />
      )}
    </View>
  );
});

export function RowHeader({
  label,
  more,
  onPress,
}: {
  label: string;
  more?: Record<string, string> | null;
  onPress?: () => void;
}) {
  const press = onPress ?? (more ? () => openGrid(label, more) : undefined);
  const heading = (
    <Text variant="headline" numberOfLines={1} style={styles.headerLabel}>
      {label}
    </Text>
  );
  if (!press) return <View style={styles.header}>{heading}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, see all`}
      onPress={press}
      style={({ pressed }) => [styles.header, { opacity: pressed ? 0.6 : 1 }]}
    >
      {heading}
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

/** A horizontal, recycled row whose tiles all share one width. */
export function HorizontalRow<T>({
  data,
  itemWidth,
  height,
  keyOf,
  render,
}: {
  data: readonly T[];
  itemWidth: number;
  height: number;
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
}) {
  const getItemLayout = useCallback(
    (_: ArrayLike<T> | null | undefined, index: number) => ({
      length: itemWidth + GAP,
      offset: EDGE + (itemWidth + GAP) * index,
      index,
    }),
    [itemWidth],
  );
  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={keyOf}
      renderItem={({ item, index }) => (
        <View style={{ width: itemWidth, marginRight: GAP }}>
          {render(item, index)}
        </View>
      )}
      getItemLayout={getItemLayout}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rowContent}
      style={{ height }}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

const keyOfTitle = (title: TitleSummary) => title.id;

const PosterRow = memo(function PosterRow({
  items,
  metrics,
}: {
  items: TitleSummary[];
  metrics: RowMetrics;
}) {
  const render = useCallback(
    (title: TitleSummary) => (
      <PosterTile title={title} width={metrics.poster} />
    ),
    [metrics.poster],
  );
  return (
    <HorizontalRow
      data={items}
      itemWidth={metrics.poster}
      height={metrics.posterHeight}
      keyOf={keyOfTitle}
      render={render}
    />
  );
});

export const PosterTile = memo(function PosterTile({
  title,
  width,
}: {
  title: TitleSummary;
  width: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Poster title={title} width={width} />
    </Pressable>
  );
});

const WideRow = memo(function WideRow({
  items,
  metrics,
}: {
  items: TitleSummary[];
  metrics: RowMetrics;
}) {
  const render = useCallback(
    (title: TitleSummary) => (
      <WideTile
        title={title}
        width={metrics.wide}
        height={metrics.wideHeight}
      />
    ),
    [metrics.wide, metrics.wideHeight],
  );
  return (
    <HorizontalRow
      data={items}
      itemWidth={metrics.wide}
      height={metrics.wideHeight}
      keyOf={keyOfTitle}
      render={render}
    />
  );
});

/** A 16:9 still with the title's logo, or its name, on a bottom gradient. */
export const WideTile = memo(function WideTile({
  title,
  width,
  height,
}: {
  title: TitleSummary;
  width: number;
  height: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Still title={title} width={width}>
        <LinearGradient
          colors={["rgba(12,11,10,0)", "rgba(12,11,10,0.85)"]}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.wideCaption}>
          <TitleLogo
            title={title}
            maxWidth={width * 0.62}
            height={Math.round(height * 0.24)}
            variant="heading"
          />
        </View>
      </Still>
    </Pressable>
  );
});

/** The title's transparent logo when TMDB has one, otherwise its name in display type. */
export function TitleLogo({
  title,
  maxWidth,
  height,
  variant = "title",
  align = "left",
}: {
  title: Pick<TitleSummary, "title" | "logoPath">;
  maxWidth: number;
  height: number;
  variant?: "marquee" | "hero" | "display" | "title" | "heading";
  align?: "left" | "center";
}) {
  const uri = tmdbImage(title.logoPath ?? null, "w500");
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={title.title}
        style={{ width: maxWidth, height }}
        contentFit="contain"
        contentPosition={align}
        recyclingKey={uri}
        transition={160}
      />
    );
  }
  return (
    <Text
      variant={variant}
      numberOfLines={2}
      style={[{ maxWidth }, align === "center" ? styles.center : null]}
    >
      {title.title}
    </Text>
  );
}

const Top10Row = memo(function Top10Row({
  items,
  metrics,
}: {
  items: TitleSummary[];
  metrics: RowMetrics;
}) {
  const width = metrics.rankNumeral + metrics.poster;
  const render = useCallback(
    (title: TitleSummary, index: number) => (
      <Top10Tile title={title} rank={index + 1} metrics={metrics} />
    ),
    [metrics],
  );
  return (
    <HorizontalRow
      data={items}
      itemWidth={width}
      height={metrics.posterHeight}
      keyOf={keyOfTitle}
      render={render}
    />
  );
});

const Top10Tile = memo(function Top10Tile({
  title,
  rank,
  metrics,
}: {
  title: TitleSummary;
  rank: number;
  metrics: RowMetrics;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Number ${rank}, ${title.title}`}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => [styles.top10, { opacity: pressed ? 0.7 : 1 }]}
    >
      <RankNumeral
        rank={rank}
        width={metrics.rankNumeral}
        height={metrics.posterHeight}
      />
      <Poster title={title} width={metrics.poster} />
    </Pressable>
  );
});

const OUTLINE: readonly [number, number][] = [
  [-1.5, 0],
  [1.5, 0],
  [0, -1.5],
  [0, 1.5],
];

/** A tall outlined numeral: four muted copies offset around an ink one. */
export function RankNumeral({
  rank,
  width,
  height,
}: {
  rank: number;
  width: number;
  height: number;
}) {
  const size = Math.round(height * (rank >= 10 ? 0.62 : 0.86));
  const glyph = {
    fontFamily: fonts.display,
    fontSize: size,
    lineHeight: Math.round(size * 1.02),
    letterSpacing: rank >= 10 ? -size * 0.08 : 0,
    // The line box keeps room for descenders under the figures; drop it so they sit on the poster's foot.
    bottom: -Math.round(size * 0.2),
  };
  return (
    <View
      style={[styles.numeral, { width, height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {OUTLINE.map(([x, y]) => (
        <Text
          key={`${x}:${y}`}
          style={[
            glyph,
            styles.numeralLayer,
            {
              color: colors.muted,
              transform: [{ translateX: x }, { translateY: y }],
            },
          ]}
        >
          {rank}
        </Text>
      ))}
      <Text style={[glyph, styles.numeralLayer, { color: colors.ink }]}>
        {rank}
      </Text>
    </View>
  );
}

const keyOfContinue = (item: ContinueWatchingItem) => item.title.id;

const ContinueRow = memo(function ContinueRow({
  items,
  metrics,
}: {
  items: ContinueWatchingItem[];
  metrics: RowMetrics;
}) {
  const render = useCallback(
    (item: ContinueWatchingItem) => (
      <ContinueTile item={item} width={metrics.poster} />
    ),
    [metrics.poster],
  );
  return (
    <HorizontalRow
      data={items}
      itemWidth={metrics.poster}
      height={metrics.posterHeight + CONTINUE_BAR}
      keyOf={keyOfContinue}
      render={render}
    />
  );
});

const CONTINUE_BAR = 40;

/** Poster that plays from where it stopped, a progress line, and a bar with the episode and Info. */
export const ContinueTile = memo(function ContinueTile({
  item,
  width,
}: {
  item: ContinueWatchingItem;
  width: number;
}) {
  const { title, progress, episode } = item;
  const label =
    episode && episode.season !== null && episode.episode !== null
      ? `S${episode.season} E${episode.episode}`
      : null;
  return (
    <View style={styles.continue}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Resume ${title.title}${label ? `, ${label}` : ""}`}
        onPress={() => playTitle(title.id, progress.episodeId)}
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        <Poster title={title} width={width} />
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playDisc}>
            <Play color={colors.paper} fill={colors.paper} size={20} />
          </View>
        </View>
        <ProgressLine
          value={progressFraction(progress.positionS, progress.durationS)}
          style={styles.continueProgress}
        />
      </Pressable>
      <View style={styles.continueBar}>
        <Text
          variant="caption"
          color="muted"
          numberOfLines={1}
          style={styles.grow}
        >
          {label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`About ${title.title}`}
          hitSlop={10}
          onPress={() => openTitle(title.id)}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Info color={colors.paper} size={18} />
        </Pressable>
      </View>
    </View>
  );
});

/** Holds a row's place while it loads: a heading bar and a few posters. */
export function RowSkeleton({
  metrics,
  wide,
}: {
  metrics: RowMetrics;
  wide?: boolean;
}) {
  const width = wide ? metrics.wide : metrics.poster;
  const height = wide ? metrics.wideHeight : metrics.posterHeight;
  const count = Math.ceil(metrics.width / (width + GAP));
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Skeleton style={{ width: 140, height: 16 }} />
      </View>
      <View style={[styles.rowContent, styles.skeletonRow]}>
        {Array.from({ length: count }, (_, index) => (
          <Skeleton
            key={index}
            style={{ width, height, borderRadius: radius.poster }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: EDGE,
    minHeight: 28,
  },
  headerLabel: { flexShrink: 1 },
  rowContent: { paddingHorizontal: EDGE },
  skeletonRow: { flexDirection: "row", gap: GAP, overflow: "hidden" },
  center: { textAlign: "center" },
  wideCaption: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
  },
  top10: { flexDirection: "row", alignItems: "flex-end" },
  numeral: {
    justifyContent: "flex-end",
    alignItems: "flex-end",
    overflow: "hidden",
  },
  numeralLayer: { position: "absolute", right: -2 },
  continue: {
    borderRadius: radius.poster,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  playDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.paper,
    backgroundColor: "rgba(12,11,10,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  continueProgress: { borderRadius: 0 },
  continueBar: {
    height: CONTINUE_BAR - 3,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  grow: { flex: 1 },
});
