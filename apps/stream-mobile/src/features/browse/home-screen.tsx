import type { BrowseRow, BrowseTab } from "@repo/schemas/stream";
import { tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  ChevronDown,
  Clapperboard,
  CloudOff,
  Search,
  X,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  type FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrowse, useInList, useToggleWatchlist } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { Button, Chip, colors, EmptyState, spacing } from "@/ui";
import { Billboard, BillboardSkeleton, billboardHeight } from "./billboard";
import { EDGE, useRowMetrics } from "./metrics";
import { BrowseRowView, RowSkeleton } from "./rows";
import { TOP_BAR_HEIGHT, TopBar } from "./top-bar";

type HomeTab = Extract<BrowseTab, "home" | "series" | "films">;

const CHIPS_HEIGHT = 48;

const keyOfRow = (row: BrowseRow) => row.id;

/** Home: the billboard card, then rows; Series and Films narrow the same page. */
export function HomeScreen() {
  const metrics = useRowMetrics();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { key, lead } = useAudience();
  const [tab, setTab] = useState<HomeTab>("home");
  const browse = useBrowse(key, tab);
  const inList = useInList(lead.id);
  const toggle = useToggleWatchlist(lead.id);
  const list = useRef<FlatList<BrowseRow>>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const top = insets.top + TOP_BAR_HEIGHT + CHIPS_HEIGHT;
  const cardHeight = billboardHeight(metrics.width, screenHeight);
  const data = browse.data;
  const rows = data?.rows.filter((row) => row.items.length > 0) ?? [];
  const billboard = data?.billboard ?? null;

  const choose = (next: HomeTab) => {
    setTab(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const renderRow = useCallback(
    ({ item }: { item: BrowseRow }) => (
      <BrowseRowView row={item} metrics={metrics} />
    ),
    [metrics],
  );

  const ambient = billboard
    ? tmdbImage(
        billboard.title.backdropPath ?? billboard.title.posterPath,
        "w342",
      )
    : null;

  const header = (
    <View style={styles.header}>
      {ambient ? (
        <View
          pointerEvents="none"
          style={[
            styles.ambient,
            { top: -top, height: top + cardHeight * 0.75 },
          ]}
        >
          <Image
            source={{ uri: ambient }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={60}
            transition={400}
          />
          <LinearGradient
            colors={["rgba(12,11,10,0.35)", colors.ink]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {billboard ? (
        <Billboard
          billboard={billboard}
          inList={inList(billboard.title.id) ?? billboard.inWatchlist}
          onToggleList={() =>
            toggle.mutate({
              title: billboard.title,
              add: !(inList(billboard.title.id) ?? billboard.inWatchlist),
            })
          }
          width={metrics.width}
          height={cardHeight}
        />
      ) : !data && browse.isPending ? (
        <BillboardSkeleton width={metrics.width} height={cardHeight} />
      ) : null}
    </View>
  );

  const empty = !data ? (
    browse.isError ? (
      <EmptyState
        icon={CloudOff}
        title="Home didn't load"
        message="We couldn't reach Stream. Check your internet connection and try again."
        action={
          <Button label="Try again" onPress={() => void browse.refetch()} />
        }
      />
    ) : (
      <View style={styles.skeletons}>
        <RowSkeleton metrics={metrics} />
        <RowSkeleton metrics={metrics} wide />
        <RowSkeleton metrics={metrics} />
      </View>
    )
  ) : billboard ? null : (
    <EmptyState
      icon={Clapperboard}
      title="Nothing to show yet"
      message="We're still filling the shelves. Pull down to refresh in a little while, or search for something you have in mind."
      action={
        <Button
          label="Search"
          icon={Search}
          variant="secondary"
          onPress={() => router.push("/search")}
        />
      }
    />
  );

  return (
    <View style={styles.screen}>
      <Animated.FlatList
        ref={list}
        data={rows}
        keyExtractor={keyOfRow}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: top + spacing.sm, paddingBottom: insets.bottom + 96 },
        ]}
        initialNumToRender={4}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={browse.isRefetching && !browse.isPlaceholderData}
            onRefresh={() => void browse.refetch()}
            tintColor={colors.muted}
            progressViewOffset={top}
          />
        }
      />
      <TopBar scrollY={scrollY}>
        <FilterChips tab={tab} onChange={choose} />
      </TopBar>
    </View>
  );
}

/** Series · Films · Categories; once one is picked, a close button and "All categories". */
function FilterChips({
  tab,
  onChange,
}: {
  tab: HomeTab;
  onChange: (tab: HomeTab) => void;
}) {
  const categories = () =>
    router.push({
      pathname: "/categories",
      params:
        tab === "home" ? {} : { type: tab === "series" ? "series" : "movie" },
    });
  const chevron = <ChevronDown color={colors.paper} size={14} />;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chips}
      contentContainerStyle={styles.chipRow}
    >
      {tab !== "home" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show everything"
          onPress={() => onChange("home")}
          hitSlop={6}
          style={({ pressed }) => [
            styles.close,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <X color={colors.paper} size={16} />
        </Pressable>
      ) : null}
      {tab !== "films" ? (
        <Chip
          label="Series"
          outline
          selected={tab === "series"}
          onPress={() => onChange(tab === "series" ? "home" : "series")}
        />
      ) : null}
      {tab !== "series" ? (
        <Chip
          label="Films"
          outline
          selected={tab === "films"}
          onPress={() => onChange(tab === "films" ? "home" : "films")}
        />
      ) : null}
      <Chip
        label={tab === "home" ? "Categories" : "All categories"}
        outline
        trailing={chevron}
        onPress={categories}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { gap: spacing.xl },
  header: { paddingBottom: spacing.xs },
  ambient: { position: "absolute", left: 0, right: 0 },
  skeletons: { gap: spacing.xl },
  chips: { height: CHIPS_HEIGHT, flexGrow: 0 },
  chipRow: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: EDGE,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.faint,
    alignItems: "center",
    justifyContent: "center",
  },
});
