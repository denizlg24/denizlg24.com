import type { TitleSummary } from "@repo/schemas/stream";
import { router } from "expo-router";
import { ChevronLeft, CloudOff, SearchX } from "lucide-react-native";
import { type ReactElement, useCallback } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTitleGrid } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import {
  Button,
  colors,
  EmptyState,
  IconButton,
  Skeleton,
  spacing,
  Text,
} from "@/ui";
import { EDGE, GAP, useRowMetrics } from "./metrics";
import { PosterTile } from "./rows";

/** A heading and a back button over a three-up poster grid. */
export function GridHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <IconButton
        icon={ChevronLeft}
        label="Back"
        onPress={() => router.back()}
      />
      <Text
        variant="title"
        numberOfLines={1}
        style={styles.headerTitle}
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  );
}

/** Three posters to a line, recycled; used by every grid on the phone. */
export function PosterGrid({
  titles,
  header,
  empty,
  footer,
  onEndReached,
}: {
  titles: TitleSummary[];
  header?: ReactElement | null;
  empty?: ReactElement | null;
  footer?: ReactElement | null;
  onEndReached?: () => void;
}) {
  const metrics = useRowMetrics();
  const insets = useSafeAreaInsets();
  const column = metrics.gridColumn;
  const renderItem = useCallback(
    ({ item }: { item: TitleSummary }) => (
      <PosterTile title={item} width={column} />
    ),
    [column],
  );
  return (
    <FlatList
      data={titles}
      numColumns={3}
      keyExtractor={(title) => title.id}
      renderItem={renderItem}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={[
        styles.grid,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

export function GridSkeleton({ rows = 3 }: { rows?: number }) {
  const metrics = useRowMetrics();
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: rows * 3 }, (_, index) => (
        <Skeleton
          key={index}
          style={{
            width: metrics.gridColumn,
            height: metrics.gridColumn * 1.5,
          }}
        />
      ))}
    </View>
  );
}

/** `GET /titles` with whatever params opened it: a row's "more", a genre, a theme, an actor. */
export function GridScreen({
  title,
  params,
}: {
  title: string;
  params: Record<string, string>;
}) {
  const { lead } = useAudience();
  const result = useTitleGrid(params, lead.id);
  const titles = result.data?.pages.flatMap((page) => page.titles) ?? [];
  return (
    <View style={styles.screen}>
      <GridHeader title={title} />
      <PosterGrid
        titles={titles}
        empty={
          result.isPending ? (
            <GridSkeleton rows={4} />
          ) : result.isError ? (
            <EmptyState
              icon={CloudOff}
              title="This didn't load"
              message="We couldn't reach Stream. Check your internet connection and try again."
              action={
                <Button
                  label="Try again"
                  onPress={() => void result.refetch()}
                />
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nothing here yet"
              message="There aren't any films or series for this in the catalogue yet."
            />
          )
        }
        footer={
          result.isFetchingNextPage ? (
            <ActivityIndicator color={colors.muted} style={styles.more} />
          ) : null
        }
        onEndReached={() => {
          if (result.hasNextPage && !result.isFetchingNextPage) {
            void result.fetchNextPage();
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    gap: spacing.xxs,
  },
  headerTitle: { flex: 1, minWidth: 0, paddingRight: EDGE },
  grid: { paddingHorizontal: EDGE, paddingTop: spacing.sm, gap: GAP },
  gridRow: { gap: GAP },
  skeleton: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  more: { marginVertical: spacing.lg },
});
