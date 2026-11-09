import type { BrowseRow, TitleSummary } from "@repo/schemas/stream";
import { Check, CloudOff, Play, Plus, Sparkles } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrowse, useInList, useToggleWatchlist } from "@/api/stream";
import { openTitle, playTitle } from "@/features/title/open";
import { useAudience } from "@/lib/audience-store";
import { titleFacts } from "@/lib/format";
import { releaseNote } from "@/lib/release";
import {
  Button,
  Chip,
  colors,
  EmptyState,
  MetaRow,
  Skeleton,
  StackedAction,
  Still,
  spacing,
  Text,
} from "@/ui";
import { EDGE, GAP, useRowMetrics } from "./metrics";
import { RankNumeral, TitleLogo } from "./rows";
import { TopBar } from "./top-bar";

interface Entry {
  title: TitleSummary;
  /** 1–10 in a Top 10 section. */
  rank: number | null;
}

interface Section {
  key: string;
  title: string;
  data: Entry[];
}

const LEAD = 52;

/** Continue watching belongs on Home; here every section is something new. */
function toSections(rows: BrowseRow[]): Section[] {
  return rows
    .flatMap((row) =>
      row.kind === "continue"
        ? []
        : [
            {
              key: row.id,
              title: row.label,
              data: row.items.map((title, index) => ({
                title,
                rank: row.kind === "top10" ? index + 1 : null,
              })),
            },
          ],
    )
    .filter((section) => section.data.length > 0);
}

/** New & Popular: each section a column of wide cards, jumped to from the chips. */
export function NewScreen() {
  const metrics = useRowMetrics();
  const insets = useSafeAreaInsets();
  const { key, lead } = useAudience();
  const browse = useBrowse(key, "new");
  const inList = useInList(lead.id);
  const toggle = useToggleWatchlist(lead.id);
  const sections = useMemo(
    () => toSections(browse.data?.rows ?? []),
    [browse.data],
  );
  const list = useRef<SectionList<Entry, Section>>(null);
  const [active, setActive] = useState<string | null>(null);
  const cardWidth = metrics.width - EDGE * 2 - LEAD - GAP;

  const jump = (index: number) => {
    const section = sections[index];
    if (!section) return;
    setActive(section.key);
    list.current?.scrollToLocation({
      sectionIndex: index,
      itemIndex: 0,
      viewOffset: 56,
      animated: true,
    });
  };

  const renderItem = useCallback(
    ({ item }: { item: Entry }) => {
      const saved = inList(item.title.id) ?? false;
      return (
        <NewCard
          entry={item}
          width={cardWidth}
          inList={saved}
          onToggleList={() => toggle.mutate({ title: item.title, add: !saved })}
        />
      );
    },
    [cardWidth, inList, toggle],
  );

  return (
    <View style={styles.screen}>
      <TopBar title="New & Popular">
        {sections.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chips}
            contentContainerStyle={styles.chipRow}
          >
            {sections.map((section, index) => (
              <Chip
                key={section.key}
                label={section.title}
                selected={(active ?? sections[0]?.key) === section.key}
                onPress={() => jump(index)}
              />
            ))}
          </ScrollView>
        ) : null}
      </TopBar>
      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(entry, index) => `${entry.title.id}:${index}`}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="title" numberOfLines={1}>
              {section.title}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => undefined}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        initialNumToRender={4}
        windowSize={7}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={browse.isRefetching}
            onRefresh={() => void browse.refetch()}
            tintColor={colors.muted}
          />
        }
        ListEmptyComponent={
          browse.isError ? (
            <EmptyState
              icon={CloudOff}
              title="This didn't load"
              message="We couldn't reach Stream. Check your internet connection and try again."
              action={
                <Button
                  label="Try again"
                  onPress={() => void browse.refetch()}
                />
              }
            />
          ) : browse.isPending ? (
            <NewSkeleton width={cardWidth} />
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Nothing new just yet"
              message="New films and series show up here as they arrive. Pull down to check again."
            />
          )
        }
      />
    </View>
  );
}

const NewCard = memo(function NewCard({
  entry,
  width,
  inList,
  onToggleList,
}: {
  entry: Entry;
  width: number;
  inList: boolean;
  onToggleList: () => void;
}) {
  const { title, rank } = entry;
  const note = releaseNote(title.releaseDate ?? null);
  const height = Math.round((width * 9) / 16);
  return (
    <View style={styles.card}>
      <View style={styles.lead}>
        {rank !== null ? (
          <RankNumeral rank={rank} width={LEAD} height={88} />
        ) : note?.day ? (
          <View style={styles.date}>
            <Text variant="caption" color="muted" numberOfLines={1}>
              {note.month}
            </Text>
            <Text variant="hero">{note.day}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.body, { width }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title.title}. More about it`}
          onPress={() => openTitle(title.id)}
          style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
        >
          <Still title={title} width={width} />
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.logo}>
            <TitleLogo
              title={title}
              maxWidth={width * 0.5}
              height={Math.round(height * 0.3)}
              variant="title"
            />
          </View>
          <StackedAction
            icon={inList ? Check : Plus}
            label="My List"
            active={inList}
            width={58}
            onPress={onToggleList}
          />
          <StackedAction
            icon={Play}
            label="Play"
            width={52}
            onPress={() => playTitle(title.id)}
          />
        </View>
        {note?.text ? (
          <Text variant="footnote" numberOfLines={1}>
            {note.text}
          </Text>
        ) : null}
        {title.overview ? (
          <Text variant="subheadline" color="muted" numberOfLines={3}>
            {title.overview}
          </Text>
        ) : null}
        <MetaRow facts={titleFacts(title)} />
        {title.genres.length > 0 ? (
          <View style={styles.genres}>
            {title.genres.slice(0, 4).map((genre) => (
              <Text
                key={genre}
                variant="footnote"
                color="muted"
                numberOfLines={1}
              >
                {genre}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

function NewSkeleton({ width }: { width: number }) {
  return (
    <View style={styles.skeleton}>
      <Skeleton style={{ width: 180, height: 24, marginLeft: EDGE }} />
      {[0, 1].map((index) => (
        <View key={index} style={styles.card}>
          <View style={styles.lead} />
          <View style={[styles.body, { width }]}>
            <Skeleton style={{ width, height: (width * 9) / 16 }} />
            <Skeleton style={{ width: width * 0.5, height: 28 }} />
            <Skeleton style={{ width: width * 0.8, height: 14 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  chips: { height: 48, flexGrow: 0 },
  chipRow: { alignItems: "center", gap: spacing.sm, paddingHorizontal: EDGE },
  sectionHeader: {
    paddingHorizontal: EDGE,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  card: {
    flexDirection: "row",
    paddingHorizontal: EDGE,
    gap: GAP,
    paddingBottom: spacing.xxl,
  },
  lead: { width: LEAD, alignItems: "center" },
  date: { alignItems: "center", paddingTop: spacing.xs },
  body: { gap: spacing.sm },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 52,
  },
  logo: { flex: 1, minWidth: 0 },
  genres: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md },
  skeleton: { gap: spacing.lg, paddingTop: spacing.xl },
});
