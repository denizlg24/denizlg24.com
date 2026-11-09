import type { SearchResult, TitleSummary } from "@repo/schemas/stream";
import { router, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  CirclePlay,
  CloudOff,
  Search,
  SearchX,
  Sparkles,
  X,
} from "lucide-react-native";
import { memo, useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSearch } from "@/api/stream";
import { GridSkeleton, PosterGrid } from "@/features/browse/grid-screen";
import { EDGE, GAP } from "@/features/browse/metrics";
import { openGrid, openTitle, playTitle } from "@/features/title/open";
import { useAudience } from "@/lib/audience-store";
import { useDebounced } from "@/lib/use-debounced";
import {
  Button,
  Chip,
  colors,
  EmptyState,
  fonts,
  IconButton,
  radius,
  Skeleton,
  Still,
  spacing,
  Text,
} from "@/ui";

const STILL = 132;

/** Search as you type; with nothing typed, what everyone's looking for. */
export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { key } = useAudience();
  const params = useLocalSearchParams<{ q?: string }>();
  const [draft, setDraft] = useState(params.q ?? "");
  const q = useDebounced(draft.trim(), 250);
  const result = useSearch(key, q);
  const settled = !result.isPlaceholderData && draft.trim() === q;
  const data = settled ? result.data : undefined;
  const typing = !settled || result.isPending;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton
          icon={ChevronLeft}
          label="Back"
          onPress={() => router.back()}
        />
        <View style={styles.field}>
          <Search color={colors.muted} size={18} />
          <TextInput
            keyboardAppearance="dark"
            value={draft}
            onChangeText={setDraft}
            autoFocus
            placeholder="Search films, series, people"
            placeholderTextColor={colors.faint}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search films, series and people"
            selectionColor={colors.amber}
            style={styles.input}
          />
          {draft ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => setDraft("")}
            >
              <X color={colors.muted} size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {q ? (
        <Results
          q={q}
          data={result.data?.query ? result.data : data}
          loading={typing}
          failed={result.isError && !result.data}
          retry={() => void result.refetch()}
        />
      ) : (
        <Popular
          titles={data?.titles ?? []}
          loading={!data && !result.isError}
          failed={result.isError && !data}
          retry={() => void result.refetch()}
        />
      )}
    </View>
  );
}

function AskRow() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Not sure what to watch? Ask Stream for ideas"
      onPress={() => router.push("/ask")}
      style={({ pressed }) => [styles.ask, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Sparkles color={colors.amber} size={22} />
      <View style={styles.grow}>
        <Text variant="headline" numberOfLines={1}>
          Not sure what to watch?
        </Text>
        <Text variant="footnote" color="muted" numberOfLines={2}>
          Say what you're in the mood for and Stream will suggest something.
        </Text>
      </View>
    </Pressable>
  );
}

function Popular({
  titles,
  loading,
  failed,
  retry,
}: {
  titles: TitleSummary[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const renderItem = useCallback(
    ({ item }: { item: TitleSummary }) => <PopularRow title={item} />,
    [],
  );
  return (
    <FlatList
      data={titles}
      keyExtractor={(title) => title.id}
      renderItem={renderItem}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      ListHeaderComponent={
        <View style={styles.popularHeader}>
          <AskRow />
          <Text variant="title" style={styles.heading}>
            Popular searches
          </Text>
        </View>
      }
      ListEmptyComponent={
        failed ? (
          <EmptyState
            icon={CloudOff}
            title="Search isn't answering"
            message="We couldn't reach Stream. Check your internet connection and try again."
            action={<Button label="Try again" onPress={retry} />}
          />
        ) : loading ? (
          <View style={styles.popularSkeleton}>
            {[0, 1, 2, 3, 4].map((index) => (
              <View key={index} style={styles.popularRow}>
                <Skeleton style={{ width: STILL, height: (STILL * 9) / 16 }} />
                <Skeleton style={{ width: 140, height: 16 }} />
              </View>
            ))}
          </View>
        ) : (
          <Text variant="body" color="muted" style={styles.note}>
            Type the name of a film, a series or someone in it.
          </Text>
        )
      }
    />
  );
}

const POPULAR_ROW = Math.round((STILL * 9) / 16) + GAP;

const PopularRow = memo(function PopularRow({
  title,
}: {
  title: TitleSummary;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => [
        styles.popularRow,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Still title={title} width={STILL} />
      <Text variant="callout" numberOfLines={2} style={styles.grow}>
        {title.title}
      </Text>
      <IconButton
        icon={CirclePlay}
        label={`Play ${title.title}`}
        size={30}
        onPress={() => playTitle(title.id)}
      />
    </Pressable>
  );
});

function Results({
  q,
  data,
  loading,
  failed,
  retry,
}: {
  q: string;
  data: SearchResult | undefined;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}) {
  const shortcuts = data ? <Shortcuts data={data} /> : null;
  return (
    <PosterGrid
      titles={data?.titles ?? []}
      header={
        <View style={styles.resultsHeader}>
          {shortcuts}
          {data && data.titles.length > 0 ? (
            <Text variant="title">Films and series</Text>
          ) : null}
        </View>
      }
      empty={
        failed ? (
          <EmptyState
            icon={CloudOff}
            title="Search isn't answering"
            message="We couldn't reach Stream. Check your internet connection and try again."
            action={<Button label="Try again" onPress={retry} />}
          />
        ) : loading || !data ? (
          <GridSkeleton rows={3} />
        ) : (
          <View style={styles.noMatch}>
            <EmptyState
              icon={SearchX}
              title="No matches"
              message={`We couldn't find anything for "${q}". Check the spelling, or try a different name, an actor or a genre.`}
            />
            <AskRow />
          </View>
        )
      }
    />
  );
}

/** People, genres and themes that match, each opening its own grid. */
function Shortcuts({ data }: { data: SearchResult }) {
  const chips = [
    ...data.people.map((person) => ({
      key: `person:${person.name}`,
      label: person.name,
      open: () => openGrid(person.name, { actor: person.name, sort: "newest" }),
    })),
    ...data.genres.map((genre) => ({
      key: `genre:${genre}`,
      label: genre,
      open: () => openGrid(genre, { genres: genre }),
    })),
    ...data.keywords.map((keyword) => ({
      key: `keyword:${keyword}`,
      label: keyword,
      open: () => openGrid(capitalise(keyword), { keyword }),
    })),
  ];
  if (chips.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.shortcuts}
      contentContainerStyle={styles.shortcutRow}
    >
      {chips.map((chip) => (
        <Chip key={chip.key} label={chip.label} outline onPress={chip.open} />
      ))}
    </ScrollView>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.xs,
    paddingRight: EDGE,
    paddingVertical: spacing.xs,
  },
  field: {
    flex: 1,
    minWidth: 0,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.lifted,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingVertical: 0,
  },
  grow: { flex: 1, minWidth: 0 },
  ask: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: EDGE,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  popularHeader: {
    gap: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  heading: { paddingHorizontal: EDGE },
  popularRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: POPULAR_ROW,
    paddingLeft: EDGE,
    paddingRight: spacing.xs,
  },
  popularSkeleton: { gap: 0 },
  note: { paddingHorizontal: EDGE },
  resultsHeader: { gap: spacing.md, paddingBottom: spacing.sm },
  shortcuts: { marginHorizontal: -EDGE, flexGrow: 0 },
  shortcutRow: { gap: spacing.sm, paddingHorizontal: EDGE },
  noMatch: { gap: spacing.lg, marginHorizontal: -EDGE },
});
