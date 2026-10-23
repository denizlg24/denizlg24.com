import type { MapHighlight } from "@repo/schemas/stream";
import {
  Bookmark,
  Eye,
  LocateFixed,
  Sparkles,
  Star,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useGridBlocks, useGridMeta, useHighlights } from "@/api/stream";
import { openTitle } from "@/features/studio/open";
import { StudioHeader } from "@/features/studio/studio-header";
import { useAudience } from "@/lib/audience-store";
import { Chip, colors, IconButton, Poster, Text } from "@/ui";
import {
  BLOCK,
  blocksFor,
  type Cell,
  nearestRegion,
  pitchFor,
  visibleRange,
  wrappedKey,
} from "./grid-math";

const KINDS = [
  { label: "Everything", type: null },
  { label: "Films", type: "movie" },
  { label: "Series", type: "series" },
] as const;

export function GridScreen() {
  const { key: audienceKey } = useAudience();
  const [kind, setKind] = useState<string | null>(null);
  return (
    <GridCanvas
      key={`${audienceKey}:${kind}`}
      audience={audienceKey}
      kind={kind}
      onKind={setKind}
    />
  );
}

function GridCanvas({
  audience,
  kind,
  onKind,
}: {
  audience: string;
  kind: string | null;
  onKind: (kind: string | null) => void;
}) {
  const meta = useGridMeta(audience, kind);
  const highlights = useHighlights(audience);
  const [focus, setFocus] = useState<Cell>({ gx: 0, gy: 0 });
  const [screen, setScreen] = useState({ width: 390, height: 600 });
  const pitch = useMemo(() => pitchFor(screen.width, false), [screen.width]);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const cellX = useSharedValue(0);
  const cellY = useSharedValue(0);
  const panActive = useSharedValue(false);
  useEffect(() => {
    if (!meta.data) return;
    x.value = meta.data.start.gx;
    y.value = meta.data.start.gy;
    setFocus(meta.data.start);
  }, [meta.data, x, y]);
  const range = useMemo(
    () => visibleRange(focus, screen, pitch),
    [focus, screen, pitch],
  );
  const blockRanges = useMemo(() => {
    if (!meta.data) return [];
    const size = meta.data;
    return blocksFor(range, size).map(({ bx, by }) => ({
      x0: bx * BLOCK.w,
      y0: by * BLOCK.h,
      x1: Math.min((bx + 1) * BLOCK.w, size.width) - 1,
      y1: Math.min((by + 1) * BLOCK.h, size.height) - 1,
    }));
  }, [meta.data, range]);
  const blocks = useGridBlocks(audience, kind, blockRanges);
  const cells = new Map(
    blocks
      .flatMap((block) => block.data?.cells ?? [])
      .map((cell) => [`${cell.gx},${cell.gy}`, cell.title]),
  );
  const badges = new Map(highlights.data?.map((item) => [item.id, item]));
  const focused = meta.data ? cells.get(wrappedKey(focus, meta.data)) : null;
  const region = meta.data
    ? nearestRegion(focus, meta.data.regions, meta.data)
    : null;
  const failed = meta.isError || blocks.some((block) => block.isError);
  const layer = useAnimatedStyle(() => ({
    transform: [
      { translateX: (focus.gx - x.value) * pitch.x },
      { translateY: (focus.gy - y.value) * pitch.y },
    ],
  }));
  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
      cellX.value = Math.round(x.value);
      cellY.value = Math.round(y.value);
    })
    .onStart(() => {
      panActive.value = true;
    })
    .onUpdate((event) => {
      x.value = startX.value - event.translationX / pitch.x;
      y.value = startY.value - event.translationY / pitch.y;
      const gx = Math.round(x.value),
        gy = Math.round(y.value);
      if (gx !== cellX.value || gy !== cellY.value) {
        cellX.value = gx;
        cellY.value = gy;
        scheduleOnRN(setFocus, { gx, gy });
      }
    })
    .onEnd((event) => {
      const gx = Math.round(
        x.value - Math.max(-2, Math.min(2, (event.velocityX / pitch.x) * 0.12)),
      );
      const gy = Math.round(
        y.value - Math.max(-2, Math.min(2, (event.velocityY / pitch.y) * 0.12)),
      );
      x.value = withTiming(gx, { duration: 220 });
      y.value = withTiming(gy, { duration: 220 });
      scheduleOnRN(setFocus, { gx, gy });
    })
    .onFinalize((_event, success) => {
      if (!success && panActive.value) {
        const gx = Math.round(x.value),
          gy = Math.round(y.value);
        x.value = withTiming(gx);
        y.value = withTiming(gy);
        scheduleOnRN(setFocus, { gx, gy });
      }
      panActive.value = false;
    });
  const center = (cell: Cell) => {
    x.value = withTiming(cell.gx, { duration: 220 });
    y.value = withTiming(cell.gy, { duration: 220 });
    setFocus(cell);
  };
  const tiles = [];
  if (meta.data)
    for (let gy = range.y0; gy <= range.y1; gy++)
      for (let gx = range.x0; gx <= range.x1; gx++) {
        const cell = { gx, gy };
        const title = cells.get(wrappedKey(cell, meta.data));
        const selected = gx === focus.gx && gy === focus.gy;
        const badge = title ? badges.get(title.id) : null;
        tiles.push(
          <Pressable
            key={`${gx},${gy}`}
            accessibilityRole="button"
            accessibilityLabel={title?.title ?? "Loading title"}
            accessibilityState={{ selected }}
            disabled={!title}
            onPress={() =>
              selected && title ? openTitle(title.id) : center(cell)
            }
            style={[
              styles.tile,
              {
                width: pitch.cell,
                left:
                  screen.width / 2 + (gx - focus.gx) * pitch.x - pitch.cell / 2,
                top:
                  screen.height / 2 +
                  (gy - focus.gy) * pitch.y -
                  pitch.cell * 0.75 -
                  22,
                transform: [{ scale: selected ? 1.04 : 1 }],
                opacity: selected ? 1 : 0.75,
              },
            ]}
          >
            <View style={[styles.frame, selected && styles.selected]}>
              {title ? (
                <Poster title={title} width={pitch.cell} />
              ) : (
                <View
                  style={{
                    width: pitch.cell,
                    height: pitch.cell * 1.5,
                    backgroundColor: colors.raised,
                  }}
                />
              )}
              {badge ? (
                <View style={styles.badge}>
                  <Badge item={badge} />
                </View>
              ) : null}
            </View>
            <Text variant="caption" numberOfLines={2} style={styles.caption}>
              {title?.title ?? "Loading…"}
            </Text>
          </Pressable>,
        );
      }
  return (
    <View style={styles.screen}>
      <StudioHeader />
      <View style={styles.filters}>
        {KINDS.map((item) => (
          <Chip
            key={item.label}
            label={item.label}
            selected={kind === item.type}
            onPress={() => onKind(item.type)}
          />
        ))}
        <IconButton
          icon={LocateFixed}
          label="Back to start"
          onPress={() => meta.data && center(meta.data.start)}
        />
      </View>
      <View
        style={styles.canvas}
        onLayout={(event) => setScreen(event.nativeEvent.layout)}
      >
        <GestureDetector gesture={pan}>
          <Animated.View style={[StyleSheet.absoluteFill, layer]}>
            {tiles}
          </Animated.View>
        </GestureDetector>
        {region ? (
          <Animated.View
            key={region.genre}
            entering={FadeIn.duration(200)}
            pointerEvents="none"
            style={styles.region}
          >
            <Text variant="display">{region.genre}</Text>
          </Animated.View>
        ) : null}
        {!meta.data && !failed ? (
          <ActivityIndicator
            style={styles.loading}
            color={colors.amber}
            accessibilityLabel="Loading the grid"
          />
        ) : null}
        {failed ? (
          <Pressable
            style={styles.error}
            onPress={() => {
              void meta.refetch();
              for (const block of blocks) void block.refetch();
            }}
          >
            <Text variant="footnote">
              The grid couldn’t load. Tap to try again.
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text variant="title" numberOfLines={2}>
          {focused?.title ?? "Explore the grid"}
        </Text>
        {focused ? (
          <View style={styles.facts}>
            {focused.rating !== null ? (
              <>
                <Star size={16} color={colors.amber} fill={colors.amber} />
                <Text color="amber">{focused.rating.toFixed(1)}</Text>
              </>
            ) : null}
            <Text variant="footnote" color="muted">
              {focused.type === "movie" ? "Film" : "Series"}{" "}
              {focused.year ?? ""}
            </Text>
            {badges.get(focused.id) ? (
              <Badge item={badges.get(focused.id)!} label />
            ) : null}
          </View>
        ) : (
          <Text variant="footnote" color="muted">
            Swipe to explore. Tap a poster to choose it.
          </Text>
        )}
      </View>
    </View>
  );
}
function Badge({ item, label }: { item: MapHighlight; label?: boolean }) {
  const Icon =
    item.kind === "watched" ? Eye : item.kind === "saved" ? Bookmark : Sparkles;
  return (
    <View style={styles.facts}>
      <Icon size={15} color={colors.amber} />
      {label ? (
        <Text variant="caption" color="amber">
          {item.kind === "picked"
            ? "Picked tonight"
            : item.kind === "saved"
              ? "Saved"
              : "Watched"}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  canvas: { flex: 1, overflow: "hidden" },
  tile: { position: "absolute" },
  frame: { borderWidth: 2, borderColor: "transparent", borderRadius: 6 },
  selected: { borderColor: colors.amber },
  caption: { marginTop: 6, height: 34, textAlign: "center" },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    padding: 5,
    borderRadius: 8,
    backgroundColor: colors.ink,
  },
  region: {
    position: "absolute",
    top: 14,
    left: 20,
    backgroundColor: "rgba(12,11,10,0.85)",
    padding: 8,
    borderRadius: 8,
  },
  info: {
    minHeight: 104,
    padding: 20,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  facts: { flexDirection: "row", alignItems: "center", gap: 6 },
  error: {
    position: "absolute",
    top: 80,
    left: 16,
    right: 16,
    padding: 16,
    backgroundColor: colors.raised,
    borderRadius: 10,
  },
  loading: { ...StyleSheet.absoluteFill },
});
