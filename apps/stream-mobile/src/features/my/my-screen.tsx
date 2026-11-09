import type { ContinueWatchingItem, TitleSummary } from "@repo/schemas/stream";
import { router } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  type LucideIcon,
  Pencil,
  Settings,
  Sparkles,
  Users,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrowse, useFinished, useWatchlist } from "@/api/stream";
import {
  EDGE,
  type RowMetrics,
  useRowMetrics,
} from "@/features/browse/metrics";
import {
  ContinueTile,
  HorizontalRow,
  PosterTile,
  RowHeader,
  RowSkeleton,
} from "@/features/browse/rows";
import { TopBar } from "@/features/browse/top-bar";
import { audienceNames } from "@/lib/audience";
import { useAudience } from "@/lib/audience-store";
import { Avatar, colors, spacing, Text } from "@/ui";

/** My Stream: who's watching, Continue watching, My List, what you finished, and the settings. */
export function MyScreen() {
  const insets = useSafeAreaInsets();
  const metrics = useRowMetrics();
  const { audience, lead, key } = useAudience();
  const home = useBrowse(key, "home");
  const list = useWatchlist(lead.id);

  const continuing = useMemo(
    () => home.data?.rows.find((row) => row.kind === "continue")?.items ?? [],
    [home.data],
  );
  const finished = useFinished(lead.id);

  return (
    <View style={styles.screen}>
      <TopBar title="My Stream" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 96 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Watching as ${audienceNames(audience)}. Switch profile`}
          onPress={() => router.push("/who")}
          style={({ pressed }) => [styles.who, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Avatar name={lead.name} color={lead.color} size={72} square />
          <View style={styles.whoName}>
            <Text variant="title" numberOfLines={1} style={styles.shrink}>
              {audienceNames(audience)}
            </Text>
            <ChevronDown color={colors.paper} size={20} />
          </View>
        </Pressable>

        {continuing.length > 0 ? (
          <ContinueSection items={continuing} metrics={metrics} />
        ) : home.isPending ? (
          <RowSkeleton metrics={metrics} />
        ) : null}

        <TitlesSection
          label="My List"
          titles={list.data ?? []}
          metrics={metrics}
          loading={list.isPending}
          onMore={() => router.push("/list")}
          empty="Tap My List on anything you'd like to watch later and it will wait for you here."
        />

        {finished.data && finished.data.length > 0 ? (
          <TitlesSection
            label="Recently finished"
            titles={finished.data}
            metrics={metrics}
          />
        ) : null}

        <View style={styles.menu}>
          <MenuRow
            icon={Sparkles}
            label="Ask Stream for ideas"
            onPress={() => router.push("/ask")}
          />
          <MenuRow
            icon={Pencil}
            label={`Edit ${lead.name}'s profile`}
            onPress={() =>
              router.push({
                pathname: "/profile-edit",
                params: { id: lead.id },
              })
            }
          />
          <MenuRow
            icon={Users}
            label="Switch profiles or watch together"
            onPress={() => router.push("/who")}
          />
          <MenuRow
            icon={Settings}
            label="Profiles and account"
            onPress={() => router.push("/account")}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function ContinueSection({
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
    <View style={styles.section}>
      <RowHeader label="Continue watching" />
      <HorizontalRow
        data={items}
        itemWidth={metrics.poster}
        height={metrics.posterHeight + 40}
        keyOf={(item) => item.title.id}
        render={render}
      />
    </View>
  );
}

function TitlesSection({
  label,
  titles,
  metrics,
  loading,
  onMore,
  empty,
}: {
  label: string;
  titles: TitleSummary[];
  metrics: RowMetrics;
  loading?: boolean;
  onMore?: () => void;
  empty?: string;
}) {
  const render = useCallback(
    (title: TitleSummary) => (
      <PosterTile title={title} width={metrics.poster} />
    ),
    [metrics.poster],
  );
  if (loading) return <RowSkeleton metrics={metrics} />;
  if (titles.length === 0 && !empty) return null;
  return (
    <View style={styles.section}>
      <RowHeader
        label={label}
        onPress={titles.length > 0 ? onMore : undefined}
      />
      {titles.length > 0 ? (
        <HorizontalRow
          data={titles}
          itemWidth={metrics.poster}
          height={metrics.posterHeight}
          keyOf={(title) => title.id}
          render={render}
        />
      ) : (
        <Text variant="footnote" color="muted" style={styles.empty}>
          {empty}
        </Text>
      )}
    </View>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon color={colors.paper} size={20} />
      <Text variant="body" numberOfLines={1} style={styles.shrinkGrow}>
        {label}
      </Text>
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { gap: spacing.xxl, paddingTop: spacing.md },
  who: { alignItems: "center", gap: spacing.md, paddingHorizontal: EDGE },
  whoName: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: "100%",
  },
  shrink: { flexShrink: 1 },
  section: { gap: spacing.sm },
  empty: { paddingHorizontal: EDGE },
  menu: {
    marginHorizontal: EDGE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  shrinkGrow: { flex: 1, minWidth: 0 },
});
